import { describe, expect, it } from "vitest";
import { decodeContextCategoriesFromMain } from "./context-categories-decoding";

const reply = {
  agentId: "agent-fixture",
  threadId: "thread-fixture",
  source: "summary",
  usedTokens: 10,
  windowTokens: 20,
  categories: [{ label: "messages", tokens: 10, kind: null, isDeferred: false }],
  truncated: false,
};

describe("context categories preload boundary", () => {
  it("drops unknown provider text and paths before the renderer can read them", () => {
    expect(
      decodeContextCategoriesFromMain({
        ...reply,
        memoryFiles: [{ path: "/private/fixture" }],
        raw: "private fixture",
      }),
    ).toEqual(reply);
    expect(decodeContextCategoriesFromMain(null)).toBeNull();
  });
  it("refuses malformed known metadata and an oversized category list", () => {
    expect(() =>
      decodeContextCategoriesFromMain({
        ...reply,
        categories: [{ label: "/private/fixture", tokens: 1, kind: null, isDeferred: false }],
      }),
    ).toThrow();
    expect(() =>
      decodeContextCategoriesFromMain({ ...reply, categories: Array.from({ length: 33 }, () => reply.categories[0]) }),
    ).toThrow();
    expect(() =>
      decodeContextCategoriesFromMain({ ...reply, categories: [{ ...reply.categories[0], kind: "used" }] }),
    ).toThrow();
  });
});
