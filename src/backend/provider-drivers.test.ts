import { AGENT_PROVIDERS, agentProviderDescriptor } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { BUILT_IN_PROVIDER_DRIVERS } from "./provider-drivers";

// The renderer offers a code sign-in from the descriptor, before it asks main anything. A descriptor
// that disagrees with its driver shows a button that fails, or hides a sign-in that works.
describe("provider descriptors", () => {
  it("name the code sign-in that each driver runs", () => {
    for (const provider of AGENT_PROVIDERS) {
      const codeSignIn = BUILT_IN_PROVIDER_DRIVERS.find((driver) => driver.id === provider)?.codeSignIn;
      const expected = !codeSignIn
        ? null
        : codeSignIn.kind === "cli" && codeSignIn.flow === "paste"
          ? "paste"
          : "device";
      expect(agentProviderDescriptor(provider).localCodeSignIn, provider).toBe(expected);
    }
  });
});
