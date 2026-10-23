// The `opencode acp` of `opencode-service-failure-e2e.ts`. OpenCode 2.1.3 answers each request whose
// failure has no ACP error of its own with `-32603` "Internal error: Internal service failure" and
// the JavaScript error class in `data.errorName` (#2850). `FAKE_FAIL=initialize` fails
// `initialize`, as when OpenCode's own service does not start; `FAKE_FAIL=prompt` fails each prompt.
import { type AcpError, serveFakeAcpAgent } from "../acp-agent";

if (process.argv.includes("--version")) {
  process.stdout.write("2.1.3\n");
  process.exit(0);
}

const FAIL = process.env.FAKE_FAIL;
const MODEL = "opencode/big-pickle";
const SERVICE_FAILURE: AcpError = {
  code: -32603,
  message: "Internal error: Internal service failure",
  data: { errorName: "UnknownError" },
};

let count = 0;
serveFakeAcpAgent({
  initialize: (request, peer) => {
    if (FAIL === "initialize") {
      peer.fail(request, SERVICE_FAILURE);
      return;
    }
    peer.reply(request, { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] });
  },
  "session/new": (request, peer) => {
    count += 1;
    peer.reply(request, {
      sessionId: `s-${process.pid}-${count}`,
      models: { availableModels: [{ modelId: MODEL, name: "Big Pickle" }], currentModelId: MODEL },
    });
  },
  "session/prompt": (request, peer) => {
    if (FAIL === "prompt") {
      peer.fail(request, SERVICE_FAILURE);
      return;
    }
    peer.reply(request, { stopReason: "end_turn" });
  },
});
