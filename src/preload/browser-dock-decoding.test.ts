// @vitest-environment node

import type { BrowserDockPresentation } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import {
  decodeBrowserDockAction,
  decodeBrowserDockPresentation,
  decodeBrowserDockShown,
} from "./browser-dock-decoding";

const AGENT = {
  id: "agent-1",
  name: "Ada",
  title: "Researcher",
  description: "",
  avatarSeed: "agent-1",
  avatarHue: null,
  avatarUrl: null,
};

const PRESENTATION: BrowserDockPresentation = {
  agent: AGENT,
  agents: [AGENT],
  skills: [],
  mcpServers: [{ id: "mcp-1", name: "Files", enabled: true, transport: "stdio", command: "files", args: [], url: "" }],
  draft: { text: "Draft", revision: 2 },
  focusRequest: 0,
  sendShortcut: "meta-enter",
  working: true,
  deliveries: [],
  hold: null,
  editingDeliveryId: null,
  canSteer: true,
  canRunAsTask: false,
  island: { kind: "activity", control: "agent", label: "Reading the page" },
  handoffPending: false,
  canHandoff: true,
  canOpenChat: true,
};

describe("browser dock decoding", () => {
  it("accepts a presentation without MCP secrets, and null to hide the dock", () => {
    expect(decodeBrowserDockPresentation(PRESENTATION)).toEqual(PRESENTATION);
    expect(decodeBrowserDockPresentation(null)).toBeNull();
  });

  it("rejects a presentation that is not valid", () => {
    expect(() => decodeBrowserDockPresentation(undefined)).toThrow("Invalid browser dock presentation.");
    expect(() => decodeBrowserDockPresentation({ ...PRESENTATION, working: "yes" })).toThrow(
      "Invalid browser dock presentation.",
    );
    expect(() => decodeBrowserDockPresentation({ ...PRESENTATION, island: { kind: "unknown" } })).toThrow(
      "Invalid browser dock presentation.",
    );
    expect(() =>
      decodeBrowserDockPresentation({ ...PRESENTATION, draft: { text: "x".repeat(1_000_000), revision: 0 } }),
    ).toThrow("Invalid browser dock presentation.");
  });

  it("accepts the known actions and rejects the others", () => {
    expect(decodeBrowserDockAction({ type: "stop" })).toEqual({ type: "stop" });
    expect(decodeBrowserDockAction({ type: "reorder", deliveryIds: ["a", "b"] })).toEqual({
      type: "reorder",
      deliveryIds: ["a", "b"],
    });
    expect(() => decodeBrowserDockAction({ type: "eval", code: "1" })).toThrow("Invalid browser dock action.");
    expect(() => decodeBrowserDockAction({ type: "send" })).toThrow("Invalid browser dock action.");
    expect(() => decodeBrowserDockAction({ type: "open-link", url: "" })).toThrow("Invalid browser dock action.");
  });

  it("accepts only a boolean for the overlay state", () => {
    expect(decodeBrowserDockShown(true)).toBe(true);
    expect(decodeBrowserDockShown(false)).toBe(false);
    expect(() => decodeBrowserDockShown("true")).toThrow("Invalid browser dock state.");
  });
});
