// The `opencode acp` of `opencode-expired-key-e2e.ts`. It picks its key as OpenCode 1.18.30 to 1.18.35
// do: config `options.apiKey` first, then the `auth.json` key (`FAKE_AUTH_KEY`), then
// `OPENCODE_API_KEY`. The key named `expired` gets the text OpenCode Console sends for an expired key,
// behind the ACP SDK's `Internal error:`.
import { logEntry, serveFakeAcpAgent } from "../acp-agent";

const EXPIRED =
  "This API key has expired. Create a new API key in OpenCode Console and replace it in your client or secret store. Signing in again will not renew this key.";
const MODEL = "opencode-go/glm-5.3";

interface ProviderOptions {
  options?: { apiKey?: string; baseURL?: string };
}
const config: { provider?: Record<string, ProviderOptions | undefined> } = process.env.OPENCODE_CONFIG_CONTENT
  ? JSON.parse(process.env.OPENCODE_CONFIG_CONTENT)
  : {};
const configKey = config.provider?.["opencode-go"]?.options?.apiKey ?? null;
const key = configKey ?? process.env.FAKE_AUTH_KEY ?? process.env.OPENCODE_API_KEY ?? null;
const setup = (sessionId: string | undefined) => ({
  sessionId,
  models: { availableModels: [{ modelId: MODEL, name: "GLM 5.3" }], currentModelId: MODEL },
});
logEntry({
  event: "spawn",
  configKey,
  baseURL: config.provider?.["opencode-go"]?.options?.baseURL ?? null,
  zenKey: config.provider?.opencode?.options?.apiKey ?? null,
});

let count = 0;
serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] }),
  "session/new": (request, peer) => {
    count += 1;
    peer.reply(request, setup(`s-${process.pid}-${count}`));
  },
  "session/load": (request, peer) => {
    logEntry({ event: "load", sessionId: request.params.sessionId });
    peer.reply(request, setup(request.params.sessionId));
  },
  "session/prompt": (request, peer) => {
    logEntry({ event: "prompt", sessionId: request.params.sessionId, key });
    if (key === "expired") {
      peer.fail(request, { code: -32603, message: `Internal error: ${EXPIRED}`, data: { details: EXPIRED } });
      return;
    }
    peer.say(request.params.sessionId, "ok");
    peer.reply(request, { stopReason: "end_turn" });
  },
});
