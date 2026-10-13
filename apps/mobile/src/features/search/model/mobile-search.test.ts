import type {
  ConversationFileSearchResult,
  ConversationMessage,
  ConversationSearchPage,
  RoutineCalendarRoutine,
} from "@openbot/contracts/ipc";
import { expect, it } from "vitest";
import { decodeConversationSearchPage } from "../../workspace/model/conversation";
import type { MobileAgent } from "../../workspace/model/workspace-types";
import { mobileSearchMatchParts, mobileSearchSources, mobileSearchView } from "./mobile-search";

const agent: MobileAgent = {
  id: "chief",
  serverId: "host",
  name: "Chief",
  title: "Planner",
  description: "",
  preview: "Ready",
  updatedLabel: "",
  avatarSeed: "chief",
  avatarHue: null,
};

function message(id: string, text: string, extra: Partial<ConversationMessage> = {}): ConversationMessage {
  return { id, author: "assistant", text, createdAt: "2026-09-28T10:00:00.000Z", status: "completed", ...extra };
}

function file(agentId: string, id: string): ConversationFileSearchResult {
  return {
    agentId,
    messageId: `message-${id}`,
    createdAt: "2026-09-28T10:00:00.000Z",
    attachment: {
      id,
      name: `${id}.pdf`,
      size: 1_024,
      kind: "file",
      mimeType: "application/pdf",
      previewKind: "pdf",
      previewUrl: null,
    },
  };
}

const routine: RoutineCalendarRoutine = {
  id: "weekly",
  name: "Weekly budget",
  owner: { kind: "agent", agentId: "chief" },
  active: true,
  timezone: "Europe/Warsaw",
  schedule: { kind: "hourly", minute: 0 },
};

const page: ConversationSearchPage = {
  results: [
    { agentId: "chief", message: message("one", "Budget   draft\nready") },
    // A hidden or deleted agent is not in the list, so its message stays out of the results.
    { agentId: "hidden", message: message("two", "Budget for hidden agent") },
  ],
  total: 2,
  nextCursor: null,
};

const reader = { memberId: "me", accountUserId: "account" };
const idle = { status: "idle" } as const;
const noRoutines = { status: "idle" as const, items: [] };

function view(input: Partial<Parameters<typeof mobileSearchView>[0]>) {
  return mobileSearchView({
    query: "budget",
    filter: "all",
    reader,
    agents: [agent],
    settings: [],
    routines: noRoutines,
    messages: idle,
    files: idle,
    ...input,
  });
}

it("shows a preview of each kind in All and every result in its filter", () => {
  const messages = {
    status: "ready" as const,
    items: ["a", "b", "c", "d"].map((id) => ({ agentId: "chief", message: message(id, `Budget ${id}`) })),
    hasMore: false,
  };
  const all = view({
    messages,
    files: { status: "ready", items: [file("chief", "budget"), file("hidden", "budget-secret")], hasMore: false },
    routines: {
      status: "ready",
      items: [routine, { ...routine, id: "other", owner: { kind: "agent", agentId: "hidden" } }],
    },
  });
  expect(all.state).toBe("results");
  expect(
    all.sections.map((section) => [section.key, section.results.map((result) => result.id), section.more]),
  ).toEqual([
    ["messages", ["message:chief:a", "message:chief:b", "message:chief:c"], true],
    ["files", ["file:chief:message-budget:budget"], false],
    ["routines", ["routine:weekly"], false],
  ]);
  expect(view({ filter: "messages", messages }).sections).toMatchObject([{ key: "messages", more: false }]);
  expect(view({ filter: "messages", messages }).sections[0]?.results).toHaveLength(4);
});

it("lists agents before the user types, and asks for a word in Messages", () => {
  expect(view({ query: "" }).sections.map((section) => section.key)).toEqual(["agents"]);
  expect(view({ query: "", filter: "messages" }).state).toBe("hint");
  expect(mobileSearchSources("all", "")).toEqual({ messages: false, files: false, routines: false });
  // The Files filter lists the newest files before the user types.
  expect(mobileSearchSources("files", "")).toEqual({ messages: false, files: true, routines: false });
});

it("finds the settings pages of the app and of the server", () => {
  const settings = [
    { id: "appearance", title: "Appearance", detail: "Settings" },
    { id: "serverMembers", title: "Members", detail: "Budget team" },
  ] as const;
  // The server name finds its pages too.
  expect(
    view({ query: "budget", filter: "settings", settings: [...settings] }).sections[0]?.results.map(
      (result) => result.id,
    ),
  ).toEqual(["setting:serverMembers"]);
  expect(view({ query: "", filter: "settings", settings: [...settings] }).sections[0]?.results).toHaveLength(2);
});

it("names who wrote a message and leaves out what the chat shows no row for", () => {
  const results = view({
    filter: "messages",
    messages: {
      status: "ready",
      items: [
        {
          agentId: "chief",
          message: message("mine", "Budget mine", { author: "user", senderMember: { id: "me", name: "Me" } }),
        },
        {
          agentId: "chief",
          message: message("ana", "Budget ana", { author: "user", senderMember: { id: "ana", name: "Ana" } }),
        },
        { agentId: "chief", message: message("reply", "Budget reply") },
        { agentId: "chief", message: message("step", "Budget step", { itemType: "commentary" }) },
      ],
      hasMore: false,
    },
  }).sections[0]?.results;
  expect(results?.map((result) => (result.kind === "message" ? [result.message.id, result.from] : null))).toEqual([
    ["mine", "you"],
    ["ana", { member: "Ana" }],
    ["reply", "agent"],
  ]);
});

it("reads past pages that hold only hidden agents' matches", () => {
  const hiddenOnly = { agentId: "hidden", message: message("two", "Budget for hidden agent") };
  // More pages exist, so a page with no visible match is not "no matches".
  const reading = view({ filter: "messages", messages: { status: "ready", items: [hiddenOnly], hasMore: true } });
  expect(reading).toMatchObject({ state: "loading", readOn: { messages: true, files: false } });
  expect(view({ filter: "messages", messages: { status: "ready", items: [hiddenOnly], hasMore: false } }).state).toBe(
    "empty",
  );
  // After a few pages the screen stops reading by itself, and the user asks for the next page.
  expect(
    view({ filter: "messages", messages: { status: "ready", items: [hiddenOnly], hasMore: true, pages: 3 } }),
  ).toMatchObject({ state: "results", sections: [], loading: false, canLoadMore: true, readOn: { messages: false } });
  // Visible matches with more pages offer the older ones.
  expect(view({ filter: "messages", messages: { status: "ready", items: page.results, hasMore: true } })).toMatchObject(
    { state: "results", canLoadMore: true, readOn: { messages: false } },
  );
});

it("keeps the local matches while a host search loads or fails", () => {
  expect(view({ filter: "messages", messages: { status: "loading", items: [], hasMore: false } }).state).toBe(
    "loading",
  );
  expect(view({ filter: "messages", messages: { status: "error", items: [], hasMore: false } }).state).toBe("error");
  expect(view({ query: "chief", messages: { status: "error", items: [], hasMore: false } })).toMatchObject({
    state: "results",
    failed: true,
    sections: [{ key: "agents" }],
  });
});

it("marks each run of the query in a text", () => {
  expect(mobileSearchMatchParts("Budget draft, budget", "BUDGET")).toEqual([
    { text: "Budget", match: true },
    { text: " draft, ", match: false },
    { text: "budget", match: true },
  ]);
});

it("decodes the released search page and rejects a malformed one", () => {
  expect(decodeConversationSearchPage(page)).toEqual(page);
  expect(() => decodeConversationSearchPage({ results: [{ agentId: "chief" }], total: 1, nextCursor: null })).toThrow();
  expect(() => decodeConversationSearchPage({ results: [], total: 0 })).toThrow();
});
