import { type ConversationFileSearchPage, isAgentSummary } from "@openbot/contracts/ipc";
import {
  CONVERSATION_FILE_SEARCH_CAPABILITY,
  CONVERSATION_FILE_SEARCH_ROUTES,
  decodeConversationFileSearchResponse,
} from "@openbot/contracts/team-protocol/conversation-file-search-v1";
import { TEAM_CAPABILITIES_HEADER, TEAM_PROTOCOL_VERSION_HEADER } from "@openbot/contracts/team-protocol/v1";
import { sourceText } from "@openbot/i18n/source";
import { afterEach, describe, expect, it, vi } from "vitest";
import agentFixture from "../../packages/contracts/src/team-protocol/fixtures/v4/host-http-response.json";
import {
  createAgents,
  createTeamApiFixture,
  stopTeamApiFixtures,
  type TeamApiAgents,
} from "./team-api-server-test-harness";

afterEach(stopTeamApiFixtures);

const source = agentFixture[0];
if (!isAgentSummary(source)) throw new Error("Invalid agent fixture.");
const visible = { ...source, id: "chief", provider: "codex", model: "gpt-5" } as const;
// Protocol 6 does not know Pi, so a protocol 6 client cannot see this agent.
const hidden = { ...source, id: "hidden", provider: "pi", model: "gpt-5" } as const;

function file(agentId: string, id: string): ConversationFileSearchPage["results"][number] {
  return {
    agentId,
    messageId: `message-${id}`,
    createdAt: "2026-10-12T08:00:00.000Z",
    attachment: {
      id,
      name: `${id}.pdf`,
      size: 1_024,
      kind: "file",
      mimeType: "application/pdf",
      previewKind: "pdf",
      previewUrl: `openbot-attachment://file/${id}`,
    },
  };
}

describe("conversation file search", () => {
  it("refuses a client without the capability and leaves out the files of a hidden agent", async () => {
    const { start, signIn } = await createTeamApiFixture("conversation-files", { configure: true });
    const searchConversationFiles = vi.fn<TeamApiAgents["searchConversationFiles"]>(() => ({
      results: [file(hidden.id, "secret"), file(visible.id, "report")],
      nextCursor: "next",
    }));
    const { base } = await start({
      agents: createAgents({ listAgents: () => [visible, hidden], searchConversationFiles }),
    });
    const token = await signIn();
    const search = (capabilities: string) =>
      fetch(`${base}${CONVERSATION_FILE_SEARCH_ROUTES.search}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          [TEAM_PROTOCOL_VERSION_HEADER]: "6",
          [TEAM_CAPABILITIES_HEADER]: capabilities,
        },
        body: JSON.stringify({ query: "", cursor: null }),
      });

    const refused = await search("");
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: sourceText("error.team.conversationFileSearchUnsupported") });
    expect(searchConversationFiles).not.toHaveBeenCalled();

    const answered = await search(CONVERSATION_FILE_SEARCH_CAPABILITY);
    expect(answered.status).toBe(200);
    expect(decodeConversationFileSearchResponse(await answered.json())).toEqual({
      results: [file(visible.id, "report")],
      nextCursor: "next",
    });
    expect(searchConversationFiles).toHaveBeenCalledWith("", undefined, 50);
  });
});
