// @vitest-environment node
import { describe, expect, it } from "vitest";
import { type CustomProviderConfig, OPENCODE_PROFILE_CONFIG, openCodeConfigEnv } from "./opencode-config";

const endpoint = (id: string): CustomProviderConfig => ({
  id,
  name: "Local",
  baseUrl: "http://127.0.0.1:1234/v1",
  apiKey: null,
  models: [{ id: "m", name: "M" }],
  headers: [],
});

const config = (env: Record<string, string>) => JSON.parse(env.OPENCODE_CONFIG_CONTENT ?? "null");

describe("openCodeConfigEnv", () => {
  it("sends nothing with no key, no endpoint and no base layer", () => {
    expect(openCodeConfigEnv({}, () => [], null)).toEqual({});
  });

  it("sends the stored key to the OpenCode Go and OpenCode providers (#2544)", () => {
    expect(config(openCodeConfigEnv(OPENCODE_PROFILE_CONFIG, () => [endpoint("local")], "key"))).toEqual({
      ...OPENCODE_PROFILE_CONFIG,
      provider: {
        "opencode-go": { options: { apiKey: "key" } },
        opencode: { options: { apiKey: "key" } },
        local: expect.objectContaining({ options: { baseURL: "http://127.0.0.1:1234/v1" } }),
      },
    });
  });

  it("keeps an endpoint saved as opencode-go whole when a key is stored", () => {
    const provider = config(openCodeConfigEnv({}, () => [endpoint("opencode-go")], "key")).provider;
    expect(provider["opencode-go"]).toMatchObject({ options: { baseURL: "http://127.0.0.1:1234/v1" } });
    expect(provider["opencode-go"].options.apiKey).toBeUndefined();
    expect(provider.opencode).toEqual({ options: { apiKey: "key" } });
  });
});
