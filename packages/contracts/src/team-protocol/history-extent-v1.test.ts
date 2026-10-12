import { describe, expect, it } from "vitest";
import { CHANNEL_ROUTES } from "./channels-v1";
import { TEAM_BOOTSTRAP_CAPABILITIES, TEAM_CURRENT_CAPABILITIES } from "./current";
import { isHistoryExtentRoute, TEAM_HISTORY_EXTENT_CAPABILITY } from "./history-extent-v1";
import { teamSideRouteCodec } from "./side-routes";
import { decodeTeamProtocolV7CurrentHttpResponse, encodeTeamProtocolV7CurrentHttpResponse } from "./v7-adapter";
import { decodeTeamProtocolV7WebRtcHttpResponse, encodeTeamProtocolV7WebRtcHttpResponse } from "./v7-webrtc-adapter";

const extent = { olderCount: 40, oldestAt: "2026-09-01T00:00:00.000Z" };
const pageInfo = { hasOlder: true, olderCursor: "cursor-1" };
const page = {
  agentId: "chief",
  threadId: "thread-1",
  activeTurnId: null,
  revision: 1,
  messages: [
    { id: "message-1", author: "user", text: "Hello", createdAt: "2026-09-28T10:00:00.000Z", status: "completed" },
  ],
  references: {},
  pageInfo,
};
const source = { ...page, pageInfo: { ...pageInfo, ...extent } };
const path = "/v1/agents/chief/conversation-page?limit=10";
const channelPage = {
  channel: {
    id: "channel-1",
    name: "Project",
    title: "Release coordination",
    instructions: "Ship the project",
    members: [{ agentId: "agent-1" }],
    leadAgentId: "agent-1",
    archived: false,
    revision: 1,
    createdAt: "2026-09-07T12:00:00.000Z",
  },
  messages: [],
  tasks: [],
  olderCursor: null,
  throughSequence: 0,
};

describe("history-extent-v1", () => {
  // A protocol 6 peer reads at most 64 capabilities.
  it("is one current capability, advertised only to a protocol 7 peer", () => {
    expect(TEAM_CURRENT_CAPABILITIES).toContain(TEAM_HISTORY_EXTENT_CAPABILITY);
    expect(TEAM_BOOTSTRAP_CAPABILITIES).not.toContain(TEAM_HISTORY_EXTENT_CAPABILITY);
  });

  it("names the agent and direct page routes only", () => {
    expect(isHistoryExtentRoute("GET", path)).toBe(true);
    expect(isHistoryExtentRoute("GET", "/v1/direct/conversations/member-1/page")).toBe(true);
    expect(isHistoryExtentRoute("GET", "/v1/agents/chief/conversation")).toBe(false);
    expect(isHistoryExtentRoute("POST", path)).toBe(false);
  });

  it("keeps the released page wire without the capability", () => {
    expect(encodeTeamProtocolV7CurrentHttpResponse("GET", path, 200, source)).toBe(
      encodeTeamProtocolV7CurrentHttpResponse("GET", path, 200, page),
    );
    expect(encodeTeamProtocolV7WebRtcHttpResponse("GET", path, 200, source)).toEqual(
      encodeTeamProtocolV7WebRtcHttpResponse("GET", path, 200, page),
    );
    const channel = teamSideRouteCodec(CHANNEL_ROUTES.read);
    expect(channel?.response(CHANNEL_ROUTES.read, 200, { ...channelPage, ...extent })).toEqual(
      channel?.response(CHANNEL_ROUTES.read, 200, channelPage),
    );
  });

  it("carries the extent with the capability over HTTP, WebRTC and the channel route", () => {
    const wire = JSON.parse(encodeTeamProtocolV7CurrentHttpResponse("GET", path, 200, source, { historyExtent: true }));
    expect(wire.pageInfo).toEqual({ ...pageInfo, ...extent });
    expect(decodeTeamProtocolV7CurrentHttpResponse("GET", path, 200, wire)).toMatchObject({
      pageInfo: { ...pageInfo, ...extent },
    });
    // The host peer encodes the local HTTP wire again for the data channel.
    const frame = encodeTeamProtocolV7WebRtcHttpResponse("GET", path, 200, wire, { historyExtent: true });
    expect(decodeTeamProtocolV7WebRtcHttpResponse("GET", path, 200, frame)).toMatchObject({
      pageInfo: { ...pageInfo, ...extent },
    });
    const channel = teamSideRouteCodec(CHANNEL_ROUTES.read);
    const channelWire = channel?.response(
      CHANNEL_ROUTES.read,
      200,
      { ...channelPage, ...extent },
      { historyExtent: true },
    );
    expect(channelWire).toMatchObject(extent);
    expect(channel?.response(CHANNEL_ROUTES.read, 200, channelWire, { historyExtent: true })).toMatchObject(extent);
  });

  it("fails closed on a malformed extent", () => {
    for (const bad of [{ olderCount: -1 }, { olderCount: 1.5 }, { olderCount: "40" }, { oldestAt: "x".repeat(65) }]) {
      const value = { ...page, pageInfo: { ...pageInfo, ...bad } };
      expect(() => decodeTeamProtocolV7CurrentHttpResponse("GET", path, 200, value)).toThrow();
      expect(() => encodeTeamProtocolV7CurrentHttpResponse("GET", path, 200, value, { historyExtent: true })).toThrow(
        /Invalid history/u,
      );
      const channel = teamSideRouteCodec(CHANNEL_ROUTES.read);
      expect(() =>
        channel?.response(CHANNEL_ROUTES.read, 200, { ...channelPage, ...bad }, { historyExtent: true }),
      ).toThrow(/Invalid history/u);
    }
  });
});
