import { type AgentSummary, isAgentModel, type UsageTokens } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import type { AgentUsage } from "../database/agent-usage";
import type { ProviderSession } from "../database/provider-sessions";
import { getRecord, getString } from "../protocol";

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Translates provider counters at the process boundary, without retaining provider payloads. */
export function collectProviderUsage(
  usage: AgentUsage,
  agent: Pick<AgentSummary, "id" | "model">,
  session: Pick<ProviderSession, "id" | "provider" | "createdAt">,
  method: string,
  params: unknown,
): void {
  if (method === "turn/started") {
    const turnId = getString(getRecord(params, "turn"), "id");
    if (turnId) usage.startTurn(agent.id, session.id, turnId, session.provider, agent.model);
    return;
  }
  if (method === "model/rerouted") {
    const turnId = getString(params, "turnId");
    const model = getString(params, "toModel");
    if (turnId && isAgentModel(model)) usage.reroute(agent.id, session.id, turnId, model);
    return;
  }
  if (method !== "thread/tokenUsage/updated" && method !== "openbot/usage") return;
  const turnId = getString(params, "turnId") ?? "baseline";
  if (session.provider === "codex") {
    const tokenUsage = getRecord(params, "tokenUsage");
    const tokens = codexTokens(getRecord(tokenUsage, "total"));
    if (!tokens) return;
    const last = codexTokens(getRecord(tokenUsage, "last"));
    const previousTokens = last && before(tokens, last);
    usage.record({
      agentId: agent.id,
      sessionId: session.id,
      turnId,
      provider: session.provider,
      model: usage.turnModel(agent.id, session.id, turnId) ?? agent.model,
      // `:codex` counted cache writes as uncached input, so this counter starts again. Its first
      // update records only the last request: the requests before it were counted by `:codex`, or
      // ran in a task before task usage was collected. The last request ran now, also in a session
      // from before collection started. Without the last request, the update is a baseline.
      counterId: `${session.id}:codex:cache-writes`,
      previousTokens,
      lastRequestInputTokens: last && sum(last),
      tokens,
      baseline: turnId === "baseline" || !previousTokens,
    });
    return;
  }
  if (session.provider === "claude") {
    const models = getRecord(params, "modelUsage");
    const counterId = getString(params, "counterId");
    if (!models || !counterId) return;
    const turnModels = getRecord(params, "turnModelUsage");
    for (const [model, value] of Object.entries(models)) {
      if (!isDynamicRecord(value) || !isAgentModel(model)) continue;
      const tokens = {
        uncachedInput: count(value.inputTokens),
        cachedInput: count(value.cacheReadInputTokens),
        cacheCreation: count(value.cacheCreationInputTokens),
        output: count(value.outputTokens),
      };
      usage.record({
        agentId: agent.id,
        sessionId: session.id,
        turnId,
        provider: session.provider,
        model,
        counterId: `${session.id}:${counterId}:${model}`,
        // `modelUsage` counts the whole session, and a resumed session starts from its saved
        // totals. The first report of a resumed process carries `turnModelUsage`: the totals
        // before this turn's requests are the baseline, so the turn books only its own requests.
        // Assistant messages name the model without the `[1m]` context suffix of its usage key.
        previousTokens:
          turnModels &&
          earlier(
            tokens,
            claudeTurnTokens(getRecord(turnModels, model) ?? getRecord(turnModels, model.replace(/\[1m\]$/, ""))),
          ),
        baseline: false,
        tokens,
        reportedCost: value.costBasis === "unknown" || value.costBasis === "managed" ? null : cost(value.costUSD),
      });
    }
    return;
  }
  // ACP `Usage` is session-cumulative by contract: its fields are documented as "Sum of all token
  // types across session" and "Total input tokens across all turns". So one counter per session,
  // like Codex, and the first report of a session that predates collection is a baseline: it
  // carries tokens spent before analytics existed.
  const value = getRecord(params, "usage");
  if (!value) return;
  const input = count(value.inputTokens);
  const cached = count(value.cachedReadTokens);
  const creation = count(value.cachedWriteTokens);
  usage.record({
    agentId: agent.id,
    sessionId: session.id,
    turnId,
    provider: session.provider,
    // A model chosen while the turn runs applies from the next turn, so the turn keeps its own.
    model: usage.turnModel(agent.id, session.id, turnId) ?? agent.model,
    counterId: `${session.id}:grok`,
    baseline: session.createdAt < usage.collectionStartedAt(),
    tokens: {
      uncachedInput:
        input !== null && cached !== null && creation !== null && input >= cached + creation
          ? input - cached - creation
          : null,
      cachedInput: cached,
      cacheCreation: creation,
      output: count(value.outputTokens),
    },
  });
}

/** A model with no request in the turn used no tokens in it. */
function claudeTurnTokens(value: DynamicRecord | null): UsageTokens {
  return {
    uncachedInput: count(value?.inputTokens ?? 0),
    cachedInput: count(value?.cacheReadInputTokens ?? 0),
    cacheCreation: count(value?.cacheCreationInputTokens ?? 0),
    output: count(value?.outputTokens ?? 0),
  };
}

/** The totals before `recent`, with each count at least 0. A count is `null` when either value is unknown. */
function earlier(total: UsageTokens, recent: UsageTokens): UsageTokens {
  const result = { ...total };
  for (const key of ["uncachedInput", "cachedInput", "cacheCreation", "output"] as const) {
    const all = total[key];
    const part = recent[key];
    result[key] = all === null || part === null ? null : Math.max(0, all - part);
  }
  return result;
}

/** Codex counts cached input and cache writes inside `inputTokens`. */
function codexTokens(breakdown: DynamicRecord | null): UsageTokens | null {
  if (!breakdown) return null;
  const input = count(breakdown.inputTokens);
  const cached = count(breakdown.cachedInputTokens);
  const written = count(breakdown.cacheWriteInputTokens) ?? 0;
  return {
    uncachedInput: input !== null && cached !== null && cached + written <= input ? input - cached - written : null,
    cachedInput: cached,
    cacheCreation: written,
    output: count(breakdown.outputTokens),
  };
}

/** The session totals before the last request, or `null` when a count is unknown. */
function before(total: UsageTokens, last: UsageTokens): UsageTokens | null {
  const { uncachedInput, cachedInput, cacheCreation, output } = total;
  if (uncachedInput === null || cachedInput === null || cacheCreation === null || output === null) return null;
  if (last.uncachedInput === null || last.cachedInput === null || last.cacheCreation === null || last.output === null)
    return null;
  const earlier = {
    uncachedInput: uncachedInput - last.uncachedInput,
    cachedInput: cachedInput - last.cachedInput,
    cacheCreation: cacheCreation - last.cacheCreation,
    output: output - last.output,
  };
  return Object.values(earlier).every((value) => value >= 0) ? earlier : null;
}

function sum(tokens: UsageTokens): number | null {
  return tokens.uncachedInput === null || tokens.cachedInput === null || tokens.cacheCreation === null
    ? null
    : tokens.uncachedInput + tokens.cachedInput + tokens.cacheCreation;
}
function cost(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
