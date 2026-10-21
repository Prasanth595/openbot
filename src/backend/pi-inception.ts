import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { PiMcpExtension } from "./pi-mcp";
import { providerCall } from "./provider-client-effects";

// Inception serves Mercury through OpenAI chat completions. Pi has no built-in Inception provider,
// so this extension registers one for this process only. The key arrives in the environment, is
// removed before a tool can start a child process, and is never written to the extension file.
// Pi runs the extension again when it switches sessions, so the key stays in a process slot for
// those later runs. Pi reads an apiKey that starts with `$` or `!` as an environment reference or
// a shell command, so the key is escaped to stay a literal.
const EXTENSION = `export default function (pi) {
  const slot = Symbol.for("openbot.pi.inceptionApiKey");
  globalThis[slot] ??= process.env.OPENBOT_PI_INCEPTION_API_KEY;
  delete process.env.OPENBOT_PI_INCEPTION_API_KEY;
  const key = globalThis[slot];
  if (!key) return;
  const levels = { off: "instant", minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null };
  const model = (id, name, contextWindow, maxTokens, cost) => ({
    id, name, reasoning: true, input: ["text"], contextWindow, maxTokens, cost, thinkingLevelMap: levels,
  });
  pi.registerProvider("inception", {
    baseUrl: "https://api.inceptionlabs.ai/v1",
    api: "openai-completions",
    apiKey: key.replaceAll("$", "$$$$").replace(/^!/, "$$!"),
    models: [
      model("mercury-3", "Mercury 3", 1000000, 131072, { input: 0.1, output: 0.35, cacheRead: 0.01, cacheWrite: 0 }),
      model("mercury-2.5", "Mercury 2.5", 260000, 65536, { input: 0.2, output: 0.75, cacheRead: 0.02, cacheWrite: 0 }),
      model("mercury-2", "Mercury 2", 128000, 50000, { input: 0.25, output: 0.75, cacheRead: 0.025, cacheWrite: 0 }),
    ],
  });
}
`;

/** Owns one temporary, key-free extension file that adds Inception's Mercury models to Pi. */
export const createPiInceptionExtension = Effect.fn("PiInception.createExtension")(function* (
  key: string,
  directory?: string,
) {
  const root = directory ?? tmpdir();
  yield* providerCall(() => mkdir(root, { recursive: true, mode: 0o700 }));
  const folder = yield* providerCall(() => mkdtemp(join(root, "openbot-pi-")));
  const path = join(folder, "inception.mjs");
  yield* providerCall(() => writeFile(path, EXTENSION, { mode: 0o600 })).pipe(
    Effect.onError(() => providerCall(() => rm(folder, { recursive: true, force: true })).pipe(Effect.orDie)),
  );
  return {
    path,
    environment: { OPENBOT_PI_INCEPTION_API_KEY: key },
    secrets: [key],
    close: () => providerCall(() => rm(folder, { recursive: true, force: true })),
  } satisfies PiMcpExtension;
});
