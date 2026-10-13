import { describe, expect, it } from "vitest";
import { createWorkspacePreferences } from "./workspace-preferences";

// Persistence boundary: a remounted provider must restore visibility, without
// leaking one account/server's preferences into another workspace.
describe("remote workspace preferences", () => {
  it("restores hidden and pinned chats after restart and keeps scopes independent", () => {
    const values = new Map<string, string>();
    const storage = {
      get: (key: string) => values.get(key) ?? null,
      set: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const open = (api = "https://api.example.test", user = "alice") => createWorkspacePreferences(api, user, storage);
    open().write("host-a", { hidden: ["hidden-chat"], pinned: ["pinned-chat"] });
    expect(open().read("host-a")).toEqual({ hidden: ["hidden-chat"], pinned: ["pinned-chat"] });
    expect(open().read("host-b")).toEqual({ hidden: [], pinned: [] });
    expect(open(undefined, "bob").read("host-a")).toEqual({ hidden: [], pinned: [] });
    expect(open("https://other.example.test").read("host-a")).toEqual({ hidden: [], pinned: [] });
    open().write("host-a", { hidden: [], pinned: [] });
    expect(open().read("host-a")).toEqual({ hidden: [], pinned: [] });
  });

  it("keeps the agent preferences of a record that an app version with channels saved", () => {
    const preferences = createWorkspacePreferences("https://api.example.test", "alice", {
      get: () =>
        '{"version":1,"hidden":["agent-hidden"],"pinned":["agent-one"],"pinnedChannels":["channel-one"],"hiddenChannels":["channel-two"]}',
      set: () => {},
    });
    expect(preferences.read("host")).toEqual({ hidden: ["agent-hidden"], pinned: ["agent-one"] });
  });

  it("reads storage once and keeps a failed write from changing the stored value", () => {
    const values = new Map<string, string>();
    let reads = 0;
    let failWrites = false;
    const preferences = createWorkspacePreferences("https://api.example.test", "alice", {
      get: (key) => {
        reads += 1;
        return values.get(key) ?? null;
      },
      set: (key, value) => {
        if (failWrites) throw new Error("Storage full");
        values.set(key, value);
      },
    });
    preferences.write("host", { hidden: [], pinned: ["agent"] });
    preferences.read("host");
    preferences.read("other-host");
    preferences.read("other-host");
    expect(reads).toBe(1);
    failWrites = true;
    expect(() => preferences.write("host", { hidden: [], pinned: [] })).toThrow("Storage full");
    expect(preferences.read("host")).toEqual({ hidden: [], pinned: ["agent"] });
  });

  it("reports unreadable preferences and failed writes instead of silently resetting them", () => {
    const preferences = createWorkspacePreferences("https://api.example.test", "alice", {
      get: () => '{"version":1,"hidden":[42],"pinned":[]}',
      set: () => {
        throw new Error("Storage full");
      },
    });
    expect(() => preferences.read("host")).toThrow("The saved chat preferences could not be read.");
    expect(() => preferences.write("host", { hidden: [], pinned: [] })).toThrow("Storage full");
  });
});
