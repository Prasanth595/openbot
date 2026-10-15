import { describe, expect, it } from "vitest";
import { assertContextCategoryScope, decodeContextCategoriesFromHost } from "./remote-context-categories-decoding";

const reply = {
  agentId: "agent-fixture",
  threadId: "thread-fixture",
  source: "native",
  usedTokens: 10,
  windowTokens: 20,
  categories: [{ label: "messages", tokens: 10, kind: "used", isDeferred: null }],
  truncated: false,
};

describe("context categories host boundary", () => {
  it("copies safe fields and refuses a host reply for a different conversation", () => {
    const decoded = decodeContextCategoriesFromHost({ ...reply, providerPayload: { path: "/private/fixture" } });
    expect(decoded).toEqual(reply);
    expect(() => assertContextCategoryScope(decoded, { agentId: reply.agentId, threadId: "another-thread" })).toThrow();
    expect(() => assertContextCategoryScope(decoded, { agentId: "another-agent", threadId: reply.threadId })).toThrow();
  });
  it("rejects invalid kind metadata, non-finite totals and an oversized identifier", () => {
    expect(() =>
      decodeContextCategoriesFromHost({ ...reply, categories: [{ ...reply.categories[0], isDeferred: true }] }),
    ).toThrow();
    expect(() => decodeContextCategoriesFromHost({ ...reply, usedTokens: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => decodeContextCategoriesFromHost({ ...reply, agentId: "x".repeat(129) })).toThrow();
  });
});
