#!/usr/bin/env node
// Synthetic stdio providers for agent-conversations-e2e.ts. No model or credential is used.
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, watch, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

export const FIXTURE_VERSION = "agent-conversations-provider/1";
const root = process.env.OPENBOT_CONVERSATION_FIXTURE_ROOT;
if (!root || resolve(root) !== root || !existsSync(join(root, "guard"))) {
  process.stderr.write("The owned provider fixture guard is missing.\n");
  process.exit(71);
}
const provider = process.env.OPENBOT_CONVERSATION_FIXTURE_PROVIDER;
const accountKey = process.env.OPENBOT_CONVERSATION_FIXTURE_ACCOUNT ?? "default";
if (provider !== "codex" && provider !== "grok") process.exit(75);
if (process.argv.includes("--version")) {
  process.stdout.write(`${provider === "codex" ? "codex-cli 0.162.1" : "grok 1.0.5"} (${FIXTURE_VERSION})\n`);
  process.exit(0);
}
if (!process.argv.includes("app-server") && !process.argv.includes("stdio")) {
  process.stderr.write("The fixture refuses commands other than version or stdio serving.\n");
  process.exit(72);
}
const logPath = join(root, "provider.jsonl");
const commandsPath = join(root, "commands.jsonl");
const sessionsRoot = join(root, "sessions");
mkdirSync(sessionsRoot, { recursive: true, mode: 0o700 });
const active = new Map();
const questions = new Map();
let commandIndex = 0;
let nextRequest = 90000;
const hash = (text) => createHash("sha256").update(text).digest("hex");
const log = (entry) =>
  appendFileSync(
    logPath,
    `${JSON.stringify({ provider, accountKey, pid: process.pid, version: FIXTURE_VERSION, ...entry })}\n`,
  );
const send = (entry) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...entry })}\n`);
const answer = (id, result) => send({ id, result });
function failure(id, code, message, method = null, sessionId = null, data = undefined) {
  log({ event: "request-refused", requestId: id, method, sessionId, errorCode: code, error: message });
  send({ id, error: { code, message, ...(data === undefined ? {} : { data }) } });
}
const notify = (method, params) => send({ method, params });
const sessionPath = (id) => join(sessionsRoot, `${hash(id)}.json`);
function controlledFault(message, params) {
  const sessionId = params.threadId;
  if (typeof sessionId !== "string") return false;
  const path = join(root, `fault-${hash(`${message.method}\0${sessionId}`)}.json`);
  if (!existsSync(path)) return false;
  const fault = JSON.parse(readFileSync(path, "utf8"));
  if (fault.used === true) return false;
  if (
    fault.nonce !== readFileSync(join(root, "guard"), "utf8") ||
    fault.method !== message.method ||
    fault.sessionId !== sessionId
  )
    throw new Error("Invalid owned native fault control.");
  writeFileSync(path, JSON.stringify({ ...fault, used: true }), { mode: 0o600 });
  log({ event: "fault-consumed", method: message.method, sessionId, mode: fault.kind });
  const missing = `no rollout found for thread id ${sessionId}`;
  if (fault.kind === "timeout") return true;
  if (fault.kind === "transport") {
    log({ event: "controlled-crash", method: message.method, sessionId });
    process.exit(74);
  }
  if (fault.kind === "wrong-code") failure(message.id, -32000, missing, message.method, sessionId);
  else if (fault.kind === "code-type") failure(message.id, "-32600", missing, message.method, sessionId);
  else if (fault.kind === "wrong-id") failure(message.id, -32600, `${missing}-different`, message.method, sessionId);
  else if (fault.kind === "missing-id")
    failure(message.id, -32600, "no rollout found for thread id ", message.method, sessionId);
  else if (fault.kind === "prefix") failure(message.id, -32600, `diagnostic: ${missing}`, message.method, sessionId);
  else if (fault.kind === "suffix") failure(message.id, -32600, `${missing}; retry later`, message.method, sessionId);
  else if (fault.kind === "message-type") failure(message.id, -32600, { text: missing }, message.method, sessionId);
  else if (fault.kind === "data")
    failure(message.id, -32600, missing, message.method, sessionId, { reason: "missing_thread" });
  else if (fault.kind === "authorization")
    failure(message.id, -32600, missing, message.method, sessionId, {
      error: { type: "authorization_error" },
      status: 403,
    });
  else if (fault.kind === "exact-other-method") failure(message.id, -32600, missing, message.method, sessionId);
  else throw new Error("Unknown owned native fault control.");
  return true;
}
function readSession(id) {
  try {
    return JSON.parse(readFileSync(sessionPath(id), "utf8"));
  } catch {
    return null;
  }
}
function saveSession(session) {
  const path = sessionPath(session.id);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(session), { mode: 0o600 });
  renameSync(temporary, path);
}
function newSession(cwd) {
  const session = { id: `fixture-${provider}-${randomUUID()}`, cwd: cwd ?? null, turns: [] };
  saveSession(session);
  log({ event: "session-created", sessionId: session.id, cwdHash: hash(cwd ?? "") });
  return session;
}
function inputText(params) {
  const blocks = params.input ?? params.prompt ?? [];
  return blocks
    .filter((block) => block.type === "text" || block.type === "inputText")
    .map((block) => block.text ?? "")
    .join("\n");
}
function controls(text) {
  const matches = [...text.matchAll(/\[fixture:([a-z-]+):([a-zA-Z0-9-]+)\]/gu)];
  const selected = matches.at(-1);
  return { mode: selected?.[1] ?? "complete", tag: selected?.[2] ?? "plain" };
}
function complete(id, interrupted = false) {
  const held = active.get(id);
  if (!held) return;
  active.delete(id);
  const { session, turn, requestId, mode, tag } = held;
  const text = mode === "quiet" ? "[[no-update]]" : `fixture-answer:${tag}`;
  turn.status = interrupted ? "interrupted" : "completed";
  if (!interrupted) turn.items.push({ id: `${turn.id}:assistant`, type: "agentMessage", text });
  saveSession(session);
  if (provider === "codex") {
    if (!interrupted) {
      const item = { id: `${turn.id}:assistant`, type: "agentMessage", text: "" };
      notify("item/started", { threadId: id, turnId: turn.id, item });
      notify("item/agentMessage/delta", { threadId: id, turnId: turn.id, itemId: item.id, delta: text });
      notify("item/completed", { threadId: id, turnId: turn.id, item: { ...item, text } });
    }
    notify("turn/completed", { threadId: id, turn: { id: turn.id, status: turn.status, items: turn.items } });
  } else {
    if (!interrupted)
      notify("session/update", {
        sessionId: id,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
      });
    answer(requestId, { stopReason: interrupted ? "cancelled" : "end_turn" });
  }
  log({ event: "turn-finished", sessionId: id, turnId: turn.id, tag, status: turn.status });
}
function startTurn(message, session, params) {
  if (active.has(session.id)) return failure(message.id, -32603, "A fixture turn is already active.");
  const text = inputText(params);
  const { mode, tag } = controls(text);
  const turn = {
    id: `fixture-turn-${randomUUID()}`,
    status: "inProgress",
    startedAt: Date.now() / 1000,
    items: [
      {
        id: `fixture-user-${randomUUID()}`,
        type: "userMessage",
        clientId: params.clientUserMessageId ?? null,
        content: [{ type: "text", text }],
      },
    ],
  };
  session.turns.push(turn);
  saveSession(session);
  active.set(session.id, { session, turn, requestId: message.id, mode, tag });
  log({
    event: "turn-accepted",
    sessionId: session.id,
    turnId: turn.id,
    tag,
    mode,
    inputHash: hash(text),
    inputBytes: Buffer.byteLength(text),
    markers: [
      ...new Set(
        [...text.matchAll(/(?:subject|main|channel|messaging|teammate|routine)-[a-zA-Z0-9-]+/gu)].map(
          (match) => match[0],
        ),
      ),
    ].slice(0, 100),
  });
  if (provider === "codex" && mode !== "uncertain") {
    answer(message.id, { turn: { id: turn.id, status: "inProgress" } });
    notify("turn/started", { threadId: session.id, turn: { id: turn.id, status: "inProgress" } });
  }
  if (mode === "question" && provider === "codex") {
    const requestId = nextRequest++;
    questions.set(requestId, session.id);
    send({
      id: requestId,
      method: "item/tool/requestUserInput",
      params: {
        threadId: session.id,
        turnId: turn.id,
        questions: [
          {
            id: "fixture-choice",
            header: "Fixture",
            question: "Select the synthetic destination.",
            isSecret: false,
            options: [
              { label: "Keep", description: "Keep this subject." },
              { label: "Change", description: "Use another subject." },
            ],
          },
        ],
      },
    });
    log({ event: "question", sessionId: session.id, turnId: turn.id, requestId, tag });
  } else if (mode === "usage" && provider === "codex" && accountKey === "default") {
    notify("account/rateLimits/updated", {
      rateLimits: {
        limitId: "codex",
        primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: Date.now() / 1000 + 3600 },
        secondary: null,
      },
    });
    notify("error", { threadId: session.id, turnId: turn.id, message: "You have hit your usage limit." });
    const held = active.get(session.id);
    if (held) {
      held.turn.status = "failed";
      saveSession(session);
      active.delete(session.id);
    }
    notify("turn/completed", { threadId: session.id, turn: { id: turn.id, status: "failed" } });
    log({ event: "turn-finished", sessionId: session.id, turnId: turn.id, tag, status: "failed" });
  } else if (!["hold", "question", "uncertain"].includes(mode)) queueMicrotask(() => complete(session.id));
}
function ask(sessionId) {
  const held = active.get(sessionId);
  if (!held || provider !== "codex") return;
  const requestId = nextRequest++;
  questions.set(requestId, sessionId);
  send({
    id: requestId,
    method: "item/tool/requestUserInput",
    params: {
      threadId: sessionId,
      turnId: held.turn.id,
      questions: [
        {
          id: "fixture-choice",
          header: "Fixture",
          question: "Select the synthetic destination.",
          isSecret: false,
          options: [
            { label: "Keep", description: "Keep this subject." },
            { label: "Change", description: "Use another subject." },
          ],
        },
      ],
    },
  });
  log({ event: "question", sessionId, turnId: held.turn.id, requestId, tag: held.tag });
}
function handle(message) {
  if (message.method === undefined) {
    const sessionId = questions.get(message.id);
    if (sessionId) {
      questions.delete(message.id);
      log({
        event: "question-answered",
        sessionId,
        requestId: message.id,
        answerKeys: Object.keys(message.result?.answers ?? {}),
      });
      complete(sessionId);
    }
    return;
  }
  if (message.id === undefined) {
    if (message.method === "session/cancel") complete(message.params?.sessionId, true);
    return;
  }
  const p = message.params ?? {};
  log({
    event: "request",
    requestId: message.id,
    method: message.method,
    sessionId: p.threadId ?? p.sessionId ?? null,
  });
  if (provider === "codex") {
    if (controlledFault(message, p)) return;
    if (message.method === "initialize") return answer(message.id, { userAgent: FIXTURE_VERSION });
    if (message.method === "account/read")
      return answer(message.id, {
        account: { type: "chatgpt", email: "fixture@example.invalid", planType: "plus" },
        requiresOpenaiAuth: false,
      });
    if (message.method === "account/rateLimits/read")
      return answer(message.id, { rateLimits: null, rateLimitsByLimitId: null });
    if (message.method === "model/list")
      return answer(message.id, {
        data: [
          {
            model: "gpt-6-luna",
            displayName: "Fixture Codex",
            defaultReasoningEffort: "low",
            supportedReasoningEfforts: [{ reasoningEffort: "low" }],
          },
        ],
        nextCursor: null,
      });
    if (message.method === "thread/start")
      return answer(message.id, { thread: { id: newSession(p.cwd).id, turns: [] } });
    const session = readSession(p.threadId ?? "");
    if (
      ["thread/resume", "thread/read", "thread/turns/list", "thread/items/list", "turn/start"].includes(
        message.method,
      ) &&
      !session
    )
      return failure(message.id, -32600, `no rollout found for thread id ${p.threadId}`, message.method, p.threadId);
    if (message.method === "thread/resume" || message.method === "thread/read") {
      log({ event: "session-read", method: message.method, sessionId: session.id });
      return answer(message.id, { thread: { id: session.id, turns: session.turns } });
    }
    if (message.method === "thread/turns/list")
      return answer(message.id, {
        data: [...session.turns].reverse().map(({ items, ...turn }) => turn),
        nextCursor: null,
      });
    if (message.method === "thread/items/list") {
      const turn = session.turns.find((row) => row.id === p.turnId);
      return answer(message.id, {
        data: (turn?.items ?? []).map((item) => ({ turnId: p.turnId, item })),
        nextCursor: null,
      });
    }
    if (message.method === "turn/start") return startTurn(message, session, p);
    if (message.method === "turn/steer") {
      const held = active.get(p.threadId);
      if (!held || held.turn.id !== p.expectedTurnId) return failure(message.id, -32600, "Fixture turn changed.");
      log({
        event: "steer",
        sessionId: p.threadId,
        turnId: held.turn.id,
        textHash: hash(inputText(p)),
        markers: controls(inputText(p)).tag,
      });
      return answer(message.id, { turnId: held.turn.id });
    }
    if (message.method === "turn/interrupt") {
      answer(message.id, {});
      complete(p.threadId, true);
      return;
    }
    if (message.method === "thread/unsubscribe") {
      log({ event: "released", sessionId: p.threadId });
      return answer(message.id, { status: "Unsubscribed" });
    }
    if (["config/read", "thread/compact/start", "skills/list", "mcpServerStatus/list"].includes(message.method))
      return answer(message.id, {});
  } else {
    const models = {
      availableModels: [{ modelId: "grok-code-fast-1", name: "Fixture Grok" }],
      currentModelId: "grok-code-fast-1",
    };
    if (message.method === "initialize")
      return answer(message.id, {
        protocolVersion: 1,
        agentInfo: { name: "fixture-grok", version: FIXTURE_VERSION },
        agentCapabilities: { loadSession: true },
        authMethods: [{ id: "cached_token", name: "Synthetic account" }],
      });
    if (message.method === "authenticate") return answer(message.id, {});
    if (message.method === "_x.ai/auth/info") return answer(message.id, { email: "fixture@example.invalid" });
    if (message.method === "_x.ai/billing") return answer(message.id, {});
    if (message.method === "session/new") return answer(message.id, { sessionId: newSession(p.cwd).id, models });
    if (message.method === "session/load" || message.method === "session/resume") {
      const session = readSession(p.sessionId);
      if (!session) return failure(message.id, -32600, "Session not found.", message.method, p.sessionId);
      log({ event: "session-read", method: message.method, sessionId: session.id });
      for (const turn of session.turns)
        for (const item of turn.items) {
          if (item.type === "userMessage") {
            for (const content of item.content)
              if (content.type === "text")
                notify("session/update", {
                  sessionId: session.id,
                  update: {
                    sessionUpdate: "user_message_chunk",
                    content: { type: "text", text: content.text },
                    messageId: item.id,
                  },
                });
          } else if (item.type === "agentMessage")
            notify("session/update", {
              sessionId: session.id,
              update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: item.text } },
            });
        }
      return answer(message.id, { models });
    }
    if (message.method === "session/prompt") {
      const session = readSession(p.sessionId);
      if (!session) return failure(message.id, -32600, "Session not found.", message.method, p.sessionId);
      return startTurn(message, session, p);
    }
    if (message.method === "session/cancel") {
      answer(message.id, {});
      complete(p.sessionId, true);
      return;
    }
    if (["session/set_model", "session/set_mode", "session/set_config_option"].includes(message.method))
      return answer(message.id, {});
  }
  return failure(message.id, -32601, "The synthetic provider refuses this method.");
}
function commands() {
  const rows = readFileSync(commandsPath, "utf8").split("\n").filter(Boolean);
  for (; commandIndex < rows.length; commandIndex++) {
    const command = JSON.parse(rows[commandIndex]);
    if (command.pid && command.pid !== process.pid) continue;
    if (command.action === "finish") complete(command.sessionId);
    if (command.action === "ask") ask(command.sessionId);
    if (command.action === "crash") {
      log({ event: "controlled-crash" });
      process.exit(74);
    }
  }
}
const watcher = watch(commandsPath, commands);
commands();
log({ event: "process-started", argv: process.argv.slice(2), nodeVersion: process.version });
const input = createInterface({ input: process.stdin, terminal: false });
input.on("line", (line) => {
  try {
    handle(JSON.parse(line));
  } catch {
    process.stderr.write("The provider fixture refused an invalid record.\n");
    process.exit(73);
  }
});
input.on("close", () => {
  watcher.close();
  log({ event: "process-stopped" });
  process.exit(0);
});
