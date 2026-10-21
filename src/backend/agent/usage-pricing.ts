import type { UsageTokens } from "@openbot/contracts/ipc";

// Standard API-equivalent rates per million tokens, verified 2026-10-21.
// These are not subscription charges. No guessed alias or default-model prices.
// Claude turns are priced by the Claude SDK's own cost report, not here.
const EFFECTIVE_DATE = "2026-10-21";
const OPENAI = "https://developers.openai.com/api/docs/pricing";
const GROK = "https://docs.x.ai/developers/pricing";
interface Rates {
  input: number;
  cached: number;
  /** The rate of a cache write. Without one, an update that writes the cache stays unpriced. */
  cacheWrite?: number;
  output: number;
}
interface Price {
  source: string;
  short: Rates;
  /** A request whose prompt has at least `from` input tokens bills all its tokens at these rates. */
  long: Rates & { from: number };
}
// OpenAI: "Long context: >272K input tokens". Codex sets no cache lifetime, so a write is the
// default 30-minute write. GPT-5.5 has no cache-write charge: a write bills as input.
const OPENAI_LONG = 272_001;
// xAI: "Long context ≥ 200k tokens". It lists no cache-write rate.
const GROK_LONG = 200_000;
const PRICES: Readonly<Record<string, Price>> = {
  "codex:gpt-6-astra": {
    source: OPENAI,
    short: { input: 10, cached: 1, cacheWrite: 12.5, output: 50 },
    long: { from: OPENAI_LONG, input: 20, cached: 2, cacheWrite: 25, output: 75 },
  },
  "codex:gpt-6.1-sol": {
    source: OPENAI,
    short: { input: 2, cached: 0.1, cacheWrite: 2.5, output: 10 },
    long: { from: OPENAI_LONG, input: 4, cached: 0.2, cacheWrite: 5, output: 15 },
  },
  "codex:gpt-6-sol": {
    source: OPENAI,
    short: { input: 2, cached: 0.2, cacheWrite: 2.5, output: 10 },
    long: { from: OPENAI_LONG, input: 4, cached: 0.4, cacheWrite: 5, output: 15 },
  },
  "codex:gpt-6-luna": {
    source: OPENAI,
    short: { input: 0.1, cached: 0.01, cacheWrite: 0.125, output: 0.5 },
    long: { from: OPENAI_LONG, input: 0.2, cached: 0.02, cacheWrite: 0.25, output: 0.75 },
  },
  "codex:gpt-5.6-sol": {
    source: OPENAI,
    short: { input: 4, cached: 0.4, cacheWrite: 5, output: 20 },
    long: { from: OPENAI_LONG, input: 8, cached: 0.8, cacheWrite: 10, output: 30 },
  },
  "codex:gpt-5.6-terra": {
    source: OPENAI,
    short: { input: 2, cached: 0.2, cacheWrite: 2.5, output: 12 },
    long: { from: OPENAI_LONG, input: 4, cached: 0.4, cacheWrite: 5, output: 18 },
  },
  "codex:gpt-5.6-luna": {
    source: OPENAI,
    short: { input: 0.2, cached: 0.02, cacheWrite: 0.25, output: 1.2 },
    long: { from: OPENAI_LONG, input: 0.4, cached: 0.04, cacheWrite: 0.5, output: 1.8 },
  },
  "codex:gpt-5.5": {
    source: OPENAI,
    short: { input: 5, cached: 0.5, cacheWrite: 5, output: 30 },
    long: { from: OPENAI_LONG, input: 10, cached: 1, cacheWrite: 10, output: 45 },
  },
  "grok:grok-4.6": {
    source: GROK,
    short: { input: 2, cached: 0.5, output: 6 },
    long: { from: GROK_LONG, input: 4, cached: 1, output: 12 },
  },
  "grok:grok-build-0.1": {
    source: GROK,
    short: { input: 1, cached: 0.2, output: 2 },
    long: { from: GROK_LONG, input: 2, cached: 0.4, output: 4 },
  },
};

/**
 * Prices the tokens of one update. `lastRequestInputTokens` is the prompt of the last request in it,
 * when the provider reports one. An update under the long-context threshold cannot hold a request
 * over it. An update over it is one known request only when its input equals that last prompt;
 * otherwise it can mix short and long requests and stays unpriced.
 */
export function estimateUsageCost(
  provider: string,
  model: string,
  tokens: UsageTokens,
  lastRequestInputTokens: number | null,
): { cost: number | null; basis: string | null } {
  const price = PRICES[`${provider}:${model}`];
  if (
    !price ||
    tokens.uncachedInput === null ||
    tokens.cachedInput === null ||
    tokens.cacheCreation === null ||
    tokens.output === null
  )
    return { cost: null, basis: null };
  const input = tokens.uncachedInput + tokens.cachedInput + tokens.cacheCreation;
  const context = input < price.long.from ? "short" : input === lastRequestInputTokens ? "long" : null;
  const rates = context === "short" ? price.short : context === "long" ? price.long : null;
  if (!rates || (tokens.cacheCreation !== 0 && rates.cacheWrite === undefined)) return { cost: null, basis: null };
  return {
    cost:
      (tokens.uncachedInput * rates.input +
        tokens.cachedInput * rates.cached +
        tokens.cacheCreation * (rates.cacheWrite ?? 0) +
        tokens.output * rates.output) /
      1_000_000,
    basis: JSON.stringify({
      effectiveDate: EFFECTIVE_DATE,
      model,
      context,
      input: rates.input,
      cached: rates.cached,
      ...(rates.cacheWrite === undefined ? {} : { cacheWrite: rates.cacheWrite }),
      output: rates.output,
      source: price.source,
    }),
  };
}
