// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  decodeLocalAgentConversationEvent,
  decodeLocalAgentConversationList,
  decodeLocalAgentConversationRead,
  decodeLocalAgentConversationTarget,
} from "./agent-conversation-decoding";

const summary = {
  agentId: "chief",
  threadId: "subject-a",
  main: false,
  label: "Travel 日本語",
  archivedAt: null,
  updatedAt: "2026-10-01T00:00:00.000Z",
  activeTurnId: null,
  queuedCount: 0,
  requiresInput: false,
};
const page = {
  agentId: "chief",
  threadId: "subject-a",
  activeTurnId: null,
  revision: 0,
  messages: [],
  references: {},
  pageInfo: { hasOlder: false, olderCursor: null },
  readState: { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: null },
};
const state = { summary, page, queue: { agentId: "chief", deliveries: [] }, attention: [] };

describe("local user-conversation preload boundary", () => {
  it("rejects malformed and oversized destination and registry replies before the renderer sees them", () => {
    expect(() => decodeLocalAgentConversationTarget({ agentId: "chief", threadId: "\0other" })).toThrow();
    expect(() => decodeLocalAgentConversationTarget({ agentId: "chief", threadId: "x".repeat(129) })).toThrow();
    expect(() =>
      decodeLocalAgentConversationList({
        conversations: Array.from({ length: 52 }, (_, index) => ({ ...summary, threadId: `subject-${index}` })),
        cursor: null,
      }),
    ).toThrow();
    expect(() =>
      decodeLocalAgentConversationList({ conversations: [{ ...summary, queuedCount: -1 }], cursor: null }),
    ).toThrow();
    expect(() =>
      decodeLocalAgentConversationList({
        conversations: [{ ...summary, queuedCount: Number.MAX_SAFE_INTEGER + 1 }],
        cursor: null,
      }),
    ).toThrow();
    expect(() =>
      decodeLocalAgentConversationList({ conversations: [{ ...summary, requiresInput: "yes" }], cursor: null }),
    ).toThrow();
    expect(() =>
      decodeLocalAgentConversationList({ conversations: [{ ...summary, label: "x".repeat(161) }], cursor: null }),
    ).toThrow();
    expect(() => decodeLocalAgentConversationList({ conversations: [summary, summary], cursor: null })).toThrow();
    expect(() =>
      decodeLocalAgentConversationEvent({
        type: "list-changed",
        agentId: "chief",
        padding: "x".repeat(8 * 1024 * 1024),
      }),
    ).toThrow();
  });

  it("refuses a page, queue, attention or event for another owner or subject", () => {
    expect(() => decodeLocalAgentConversationRead({ ...state, page: { ...page, threadId: "subject-b" } })).toThrow();
    expect(() => decodeLocalAgentConversationRead({ ...state, queue: { agentId: "other", deliveries: [] } })).toThrow();
    const prompt = {
      type: "prompt",
      agentId: "chief",
      threadId: "subject-b",
      turnId: "turn-a",
      requestId: "input-a",
      questions: [],
    };
    expect(() => decodeLocalAgentConversationRead({ ...state, attention: [prompt] })).toThrow();
    expect(() =>
      decodeLocalAgentConversationEvent({
        type: "conversation-event",
        agentId: "other",
        threadId: "subject-a",
        event: { type: "conversation", snapshot: page },
      }),
    ).toThrow();
    expect(() =>
      decodeLocalAgentConversationEvent({
        type: "conversation-event",
        agentId: "chief",
        threadId: "subject-a",
        event: { type: "status", status: {} },
      }),
    ).toThrow();
  });

  it("keeps a saved Main label and full local approval text inside the bounded new envelope", () => {
    const renamedMain = { ...summary, threadId: "main-thread", main: true, label: "My main conversation" };
    expect(
      decodeLocalAgentConversationList({ conversations: [renamedMain], cursor: null }).conversations[0]?.label,
    ).toBe("My main conversation");
    const approval = {
      requestId: "approval-a",
      agentId: "chief",
      threadId: "subject-a",
      turnId: "turn-a",
      kind: "command",
      command: "x".repeat(100_001),
      cwd: null,
      reason: null,
      grantRoot: null,
      permissions: null,
    };
    const event = decodeLocalAgentConversationEvent({
      type: "conversation-event",
      agentId: "chief",
      threadId: "subject-a",
      event: { type: "approval", approval },
    });
    expect(event.type).toBe("conversation-event");
    if (event.type !== "conversation-event" || event.event.type !== "approval")
      throw new Error("Expected the full local approval.");
    expect(event.event.approval.command?.length).toBe(100_001);
    expect(
      decodeLocalAgentConversationRead({ ...state, summary: { ...summary, archivedAt: "2026-10-02" } }).summary
        .archivedAt,
    ).toBe("2026-10-02");
  });

  it("refuses a body or reference allocation beyond the new page boundary", () => {
    const message = {
      id: "row",
      author: "assistant",
      source: "assistant",
      text: "Saved",
      createdAt: "2026-10-01",
      status: "completed",
    };
    expect(() =>
      decodeLocalAgentConversationRead({
        ...state,
        page: { ...page, messages: Array.from({ length: 101 }, (_, index) => ({ ...message, id: `row-${index}` })) },
      }),
    ).toThrow();
    expect(() =>
      decodeLocalAgentConversationRead({
        ...state,
        page: {
          ...page,
          references: Object.fromEntries(
            Array.from({ length: 101 }, (_, index) => [`row-${index}`, { ...message, id: `row-${index}` }]),
          ),
        },
      }),
    ).toThrow();
    expect(() =>
      decodeLocalAgentConversationRead({
        ...state,
        attention: Array.from({ length: 33 }, () => ({
          type: "prompt",
          agentId: "chief",
          threadId: "subject-a",
          turnId: "turn-a",
          requestId: "input-a",
          questions: [],
        })),
      }),
    ).toThrow();
  });
});
