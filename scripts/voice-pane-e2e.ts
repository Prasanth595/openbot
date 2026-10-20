// Drives the Voice pane in this worktree's two-client harness (`bun run dev:test-client`). The
// microphone is a fake: the app's own speech model says a question, and getUserMedia plays it once.
//   1. Local: the host app talks to its Chief agent. The message keeps a WebM/Opus recording and
//      shows a player; the reply is read aloud.
//   2. Remote: the test client talks to the same agent through the host server. Only the text goes;
//      no player, and no recording draft stays on the client.
//   3. Storage: the host lists the recording and deletes it; the message keeps its text, no player.
//   4. Offline: the host stops serving. The client's pane releases the microphone, shows the offline
//      error and does not listen. The client stays disconnected after this case: run
//      `bun run dev:stop` and `bun run dev:test-client` before the next run.
// Writes .openbot-build/voice-pane/report.json and screenshots. Needs `--allow-mutations`:
// `bun scripts/voice-pane-e2e.ts --allow-mutations`.
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { OpenBotDesktopApi, StoredFileRow } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import type { Page } from "playwright-core";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { type DevInstanceRecord, readDevInstanceRecords } from "./dev-automation/instance-registry";

declare global {
  interface Window {
    openbot: OpenBotDesktopApi;
    voicePaneE2E?: { arm: () => void; calls: () => number; liveTracks: () => number };
  }
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/voice-pane");
const AGENT = "Chief";
const AGENT_ID = "chief";
const QUESTION = "What is two plus two? Answer in five words or fewer.";
/** 120 s of Opus at 32 kbps is about 480 KB; a short question must stay far below this. */
const MAXIMUM_RECORDING_BYTES = 600_000;
const TURN_TIMEOUT_MS = 180_000;

interface Check {
  name: string;
  passed: boolean;
  detail: unknown;
}

const records = readDevInstanceRecords().filter((record) => resolve(record.projectRoot) === resolve(process.cwd()));
const hostRecord = records.find((record) => record.service === "app");
const clientRecord = records.find((record) => record.service === "test-client");
assert.ok(hostRecord && clientRecord, "Start `bun run dev:test-client` for this worktree first.");
for (const record of [hostRecord, clientRecord])
  assertMutationAllowed({
    command: "voice-pane-e2e",
    allowMutations: process.argv.includes("--allow-mutations"),
    instanceNamed: true,
    target: record.instanceId,
  });

const logger = createOpenBotLogger("voice-pane-e2e");
const connect = (record: DevInstanceRecord) =>
  connectToDevApp(record.remoteDebuggingPort, logger, {
    expectedRendererPort: record.rendererPort,
    ownerPid: record.pid,
  });
const hostSession = await connect(hostRecord);
const clientSession = await connect(clientRecord);
const host = hostSession.page;
const client = clientSession.page;
for (const page of [host, client]) page.setDefaultTimeout(30_000);

mkdirSync(OUT, { recursive: true });
const checks: Check[] = [];
type Turn = Awaited<ReturnType<typeof speakOneTurn>>;
const report: { checks: Check[]; local?: Turn; remote?: Turn; recording?: StoredFileRow | null } = { checks };
const check = (name: string, passed: boolean, detail: unknown = null) => {
  checks.push({ name, passed, detail });
  logger.info(`${passed ? "Passed" : "Failed"}: ${name}.`);
};

/** A fake microphone. Each `arm()` makes the next stream say the question once; others are silent. */
async function installMicrophone(page: Page): Promise<void> {
  await page.evaluate(async (text) => {
    const speech = await window.openbot.voice.speak({ text, language: "en" });
    const context = new AudioContext();
    const samples = new Int16Array(speech.pcm.buffer, speech.pcm.byteOffset, speech.pcm.byteLength / 2);
    const buffer = context.createBuffer(1, samples.length, speech.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) channel[index] = (samples[index] ?? 0) / 32_768;
    let armed = false;
    let calls = 0;
    const streams: MediaStream[] = [];
    navigator.mediaDevices.getUserMedia = async () => {
      calls += 1;
      await context.resume();
      const destination = context.createMediaStreamDestination();
      if (armed) {
        armed = false;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(destination);
        source.start(context.currentTime + 0.8);
      }
      streams.push(destination.stream);
      return destination.stream;
    };
    window.voicePaneE2E = {
      arm: () => {
        armed = true;
      },
      calls: () => calls,
      liveTracks: () =>
        streams.flatMap((stream) => stream.getTracks()).filter((track) => track.readyState === "live").length,
    };
  }, QUESTION);
}

async function openAgent(page: Page): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`^${AGENT},`) }).click();
  await page.getByRole("heading", { name: AGENT, level: 1 }).waitFor();
}

async function openVoicePane(page: Page): Promise<void> {
  const panel = page.locator(".voice-panel");
  if (await panel.count()) {
    await panel.getByRole("button", { name: "End voice conversation", exact: true }).click();
    await panel.waitFor({ state: "detached" });
  }
  await page.evaluate(() => window.voicePaneE2E?.arm());
  await page.getByRole("button", { name: "Add to prompt", exact: true }).click();
  await page.getByRole("menuitem", { name: "Voice", exact: true }).click();
  await panel.waitFor();
}

async function closeVoicePane(page: Page): Promise<void> {
  const panel = page.locator(".voice-panel");
  if (!(await panel.count())) return;
  await panel.getByRole("button", { name: "End voice conversation", exact: true }).click();
  await panel.waitFor({ state: "detached" });
}

const paneState = (page: Page) =>
  page.evaluate(() => {
    const panel = document.querySelector(".voice-panel");
    return {
      phase: panel?.querySelector(".voice-panel-phase")?.textContent?.trim() ?? null,
      error: panel?.querySelector(".voice-panel-error")?.textContent?.trim() ?? null,
    };
  });

/** Waits for one spoken turn after `openVoicePane`: the reply is read aloud, then the pane listens again. */
async function speakOneTurn(page: Page, name: string) {
  const phases: string[] = [];
  const started = Date.now();
  let spoke = false;
  let error: string | null = null;
  while (Date.now() - started < TURN_TIMEOUT_MS) {
    const state = await paneState(page);
    const label = `${state.phase}${state.error ? ` | ${state.error}` : ""}`;
    if (phases.at(-1)?.endsWith(label) !== true) phases.push(`${Date.now() - started}ms ${label}`);
    if (state.phase === "Speaking" && !spoke) {
      spoke = true;
      await page.screenshot({ path: join(OUT, `${name}-speaking.png`) });
    }
    if (state.error) {
      error = state.error;
      break;
    }
    if (spoke && state.phase === "Listening") break;
    await page.waitForTimeout(100);
  }
  await page.screenshot({ path: join(OUT, `${name}-end.png`) });
  // The test client shows its own message under its account name, not "You".
  const mine = page.getByRole("article", { name: new RegExp(`^Message from (?!${AGENT}$)`) }).last();
  return {
    phases,
    spoke,
    error,
    userMessage: (await mine.textContent())?.trim() ?? null,
    hasPlayer: (await mine.getByRole("button", { name: "Play voice message", exact: true }).count()) > 0,
  };
}

async function hostFiles(): Promise<StoredFileRow[]> {
  const usage = await host.evaluate(() => window.openbot.storage.getUsage({ scope: "host", force: true }, "local"));
  return usage?.files ?? [];
}

function draftEntries(record: DevInstanceRecord): string[] {
  const directory = join(homedir(), "Library", "Application Support", record.profile, "attachment-drafts");
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

let hostStopped = false;
try {
  await installMicrophone(host);
  await installMicrophone(client);

  // 1. Local.
  await openAgent(host);
  const recordingsBefore = new Set(
    (await hostFiles()).filter((file) => file.mimeType.startsWith("audio/")).map((file) => file.id),
  );
  await openVoicePane(host);
  const local = await speakOneTurn(host, "local");
  report.local = local;
  check("local: the reply is read aloud", local.spoke && local.error === null, local.phases);
  check("local: the spoken message shows a player", local.hasPlayer, local.userMessage);
  await closeVoicePane(host);
  const recording = (await hostFiles()).find(
    (file) => file.mimeType.startsWith("audio/") && !recordingsBefore.has(file.id),
  );
  report.recording = recording ?? null;
  check(
    "local: the recording is WebM/Opus and small",
    recording?.name === "voice.webm" && recording.mimeType === "audio/webm" && recording.size < MAXIMUM_RECORDING_BYTES,
    recording && { name: recording.name, mimeType: recording.mimeType, size: recording.size },
  );

  // 2. Remote.
  const remote = (await client.evaluate(() => window.openbot.servers.list())).find(
    (server) => server.kind === "remote" && server.state === "online",
  );
  assert.ok(remote, "The test client has no online remote server.");
  await client.evaluate((id) => window.openbot.servers.select(id), remote.id);
  await openAgent(client);
  const draftsBefore = draftEntries(clientRecord);
  await openVoicePane(client);
  const remoteTurn = await speakOneTurn(client, "remote");
  report.remote = remoteTurn;
  check("remote: the reply is read aloud", remoteTurn.spoke && remoteTurn.error === null, remoteTurn.phases);
  check("remote: the message has text and no player", !remoteTurn.hasPlayer, remoteTurn.userMessage);
  const draftsAfter = draftEntries(clientRecord);
  check(
    "remote: no recording draft stays on the client",
    draftsAfter.filter((entry) => !draftsBefore.includes(entry)).length === 0,
    { draftsBefore, draftsAfter },
  );

  // 3. Storage: delete the local recording.
  if (recording) {
    // A Storage row has a message id only for a thread placement, so find the message by its recording.
    const page = await host.evaluate(
      (id) =>
        window.openbot.agent.readConversationPage({ agentId: id, anchor: { type: "latest" }, limit: 20 }, "local"),
      AGENT_ID,
    );
    const message = page.messages.find((candidate) => candidate.voiceRecording?.id === recording.id);
    check("storage: the recording belongs to the spoken message", message !== undefined, recording.id);
    await host.evaluate((fileId) => window.openbot.storage.deleteFile({ fileId }, "local"), recording.id);
    const listed = (await hostFiles()).some((file) => file.id === recording.id);
    check("storage: the deleted recording is no longer listed", !listed);
    const url = recording.previewUrl;
    const status = url ? await host.evaluate(async (target) => (await fetch(target)).status, url) : null;
    check("storage: the recording file is gone", status === 404, { status });
    if (message) {
      // The chat history keeps the message as it was sent; the bubble hides the player of a gone file.
      await host.reload();
      await openAgent(host);
      const bubble = host.getByRole("article", { name: "Message from You" }).filter({ hasText: message.text }).last();
      await bubble.waitFor();
      await bubble.getByRole("button", { name: "Play voice message", exact: true }).waitFor({ state: "detached" });
      await host.screenshot({ path: join(OUT, "storage-deleted.png") });
      check("storage: the message keeps its text and has no player", true, message.text);
    }
  }

  // 4. Offline. The client's pane listens; the host stops serving. The dev client reaches the host
  // through a local API port that a restarted host does not open again, so the client stays
  // disconnected after this case, and the return to online is not checked here.
  await client.getByText("Listening", { exact: true }).first().waitFor();
  await host.evaluate(() => window.openbot.host.stop());
  hostStopped = true;
  const offlineText = "The server is not connected. The conversation continues when it connects again.";
  await client.locator(".voice-panel-error", { hasText: offlineText }).waitFor({ timeout: 60_000 });
  await client.screenshot({ path: join(OUT, "offline.png") });
  const offline = {
    ...(await paneState(client)),
    ...(await client.evaluate(() => ({
      liveTracks: window.voicePaneE2E?.liveTracks() ?? -1,
      calls: window.voicePaneE2E?.calls() ?? -1,
    }))),
  };
  check(
    "offline: the pane says it is not connected and releases the microphone",
    offline.phase === "Not connected" && offline.liveTracks === 0,
    offline,
  );
  await host.evaluate(() => window.openbot.host.start());
  hostStopped = false;
  const later = await client.evaluate(() => ({
    calls: window.voicePaneE2E?.calls() ?? -1,
    error: document.querySelector(".voice-panel-error")?.textContent?.trim() ?? null,
  }));
  check(
    "offline: the pane does not open the microphone while the server is offline",
    later.calls === offline.calls && later.error === offlineText,
    later,
  );
  await closeVoicePane(client);
} finally {
  if (hostStopped) await host.evaluate(() => window.openbot.host.start()).catch(() => undefined);
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await hostSession.close();
  await clientSession.close();
}
const failed = checks.filter((item) => !item.passed);
for (const item of failed) logger.error(`Failed: ${item.name}.`, { detail: item.detail });
assert.equal(failed.length, 0, `${failed.length} of ${checks.length} voice pane checks failed.`);
logger.info(`Passed ${checks.length} voice pane checks. Wrote ${join(OUT, "report.json")}.`);
