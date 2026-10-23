// Runs the released workspace preference service with isolated disk storage. Fresh service
// instances reopen the saved v1 document between operations, as an app restart does.
// Run: bun scripts/mobile-agent-pins-e2e.ts
// Writes .openbot-build/mobile-agent-pins-e2e/report.json. No native app or user storage is used.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createWorkspacePreferences,
  type RemoteWorkspacePreferences,
} from "@openbot/team-client/workspace-preferences";
import {
  canToggleAgentPin,
  reconcileAgentPins,
  withAvailableAgentPins,
  withLeadAgent,
  withoutLeadAgent,
} from "../apps/mobile/src/features/workspace/model/agent-pins";

const output = resolve(import.meta.dirname, "../.openbot-build/mobile-agent-pins-e2e");
const directory = mkdtempSync(join(tmpdir(), "openbot-mobile-agent-pins-"));
const host = "mobile-pin-fixture-host";
const agents = Array.from({ length: 18 }, (_, index) => ({ id: `agent-${index + 1}` }));
let writes = 0;
const storage = {
  get: (key: string) => {
    const file = join(directory, key);
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  },
  set: (key: string, value: string) => {
    writeFileSync(join(directory, key), value);
    writes++;
  },
};
const reopen = () => createWorkspacePreferences("https://account.openbot.test", "fixture-user", storage);
const checks: string[] = [];

/** Save through the same cleanup used by the mobile workspace after an explicit preference edit. */
function save(change: (current: RemoteWorkspacePreferences) => RemoteWorkspacePreferences) {
  const store = reopen();
  const current = store.read(host);
  const next = withAvailableAgentPins(change(current), agents);
  if (next !== current) store.write(host, next);
  return reopen().read(host);
}

try {
  const initialWrites = writes;
  assert.deepEqual(reconcileAgentPins(reopen(), host, agents).pinned, []);
  assert.equal(writes, initialWrites, "A complete list must not persist a default lead pin.");
  assert.deepEqual(reopen().read(host).pinned, []);
  assert.deepEqual(save((current) => ({ ...current, hidden: [] })).pinned, []);
  checks.push("A new workspace and an unrelated saved edit keep pins empty after restart.");

  const legacyPins = ["agent-2", "agent-1"];
  // The released v1 document has no lead field. Pins must not imply a lead after an upgrade.
  reopen().write(host, { hidden: [], pinned: legacyPins });
  const legacy = reconcileAgentPins(reopen(), host, agents);
  assert.deepEqual(legacy.pinned, legacyPins);
  assert.equal(legacy.leadAgentId, undefined);
  checks.push("Released v1 pins retain their order and do not select a lead after restart.");

  const selected = save((current) => withLeadAgent(current, "agent-3"));
  assert.equal(selected.leadAgentId, "agent-3");
  assert.deepEqual(selected.pinned, legacyPins);
  assert.equal(reopen().read("another-host").leadAgentId, undefined);
  assert.equal(reopen().read(host).leadAgentId, "agent-3");
  checks.push("Set as lead saves one explicit choice per server without changing pins.");

  const beforeReplacement = reopen().read(host);
  assert.deepEqual(
    save((current) => withLeadAgent(current, "agent-1")),
    beforeReplacement,
  );
  assert.equal(reopen().read(host).leadAgentId, "agent-3");
  assert.deepEqual(
    save((current) => withoutLeadAgent(current, "agent-1")),
    beforeReplacement,
  );
  checks.push("Another lead cannot replace the selected lead, and a stale removal cannot clear it.");

  const removed = save((current) => withoutLeadAgent(current, "agent-3"));
  assert.equal(removed.leadAgentId, null);
  assert.deepEqual(removed.pinned, legacyPins);
  assert.equal(reconcileAgentPins(reopen(), host, agents).leadAgentId, null);
  const chosenAgain = save((current) => withLeadAgent(current, "agent-1"));
  assert.equal(chosenAgain.leadAgentId, "agent-1");
  assert.deepEqual(chosenAgain.pinned, legacyPins);
  checks.push("Remove lead persists without a fallback and permits a later explicit choice.");

  assert.ok(canToggleAgentPin(chosenAgain.pinned, "agent-1"));
  const unpinnedLead = save((current) => ({ ...current, pinned: current.pinned.filter((id) => id !== "agent-1") }));
  assert.equal(unpinnedLead.leadAgentId, "agent-1");
  assert.deepEqual(unpinnedLead.pinned, ["agent-2"]);
  save((current) => ({ ...current, pinned: [] }));
  const emptyWrites = writes;
  const noPins = reconcileAgentPins(reopen(), host, agents);
  assert.deepEqual(noPins.pinned, []);
  assert.equal(noPins.leadAgentId, "agent-1");
  assert.equal(writes, emptyWrites);
  checks.push("The explicit lead can be unpinned; an empty pin list stays empty after restart.");

  save((current) => ({ ...current, hidden: ["agent-1"], pinned: legacyPins }));
  const hidden = reconcileAgentPins(reopen(), host, agents);
  assert.equal(hidden.leadAgentId, "agent-1");
  assert.deepEqual(hidden.pinned, legacyPins);
  const restored = save((current) => ({ ...current, hidden: [] }));
  assert.equal(restored.leadAgentId, "agent-1");
  assert.deepEqual(restored.pinned, legacyPins);
  // Reopening and editing local preferences do not claim that a host list is complete.
  const offline = reopen();
  offline.write(host, { ...offline.read(host), hiddenChannels: ["channel-1"] });
  assert.equal(reopen().read(host).leadAgentId, "agent-1");
  assert.deepEqual(reopen().read(host).pinned, legacyPins);
  checks.push("Hide, restore, offline reopen and unrelated edits preserve the explicit lead choice.");

  const beforeDeleteWrites = writes;
  const deleted = reconcileAgentPins(
    reopen(),
    host,
    agents.filter((agent) => agent.id !== "agent-1"),
  );
  assert.equal(deleted.leadAgentId, null);
  assert.deepEqual(deleted.pinned, ["agent-2"]);
  assert.equal(writes, beforeDeleteWrites + 1);
  assert.equal(reopen().read(host).leadAgentId, null);
  const empty = reconcileAgentPins(reopen(), host, []);
  assert.deepEqual(empty.pinned, []);
  assert.equal(empty.leadAgentId, null);
  checks.push("Only a complete host list clears a deleted lead, with no replacement or automatic pin.");

  const channelPins = Array.from({ length: 15 }, (_, index) => `channel-${index + 1}`);
  save((current) => ({ ...current, pinned: ["agent-1"], pinnedChannels: channelPins }));
  const full = reopen().read(host);
  const combined = [...full.pinned, ...(full.pinnedChannels ?? [])];
  assert.equal(combined.length, 16);
  assert.equal(canToggleAgentPin(combined, "agent-2"), false);
  assert.equal(canToggleAgentPin(combined, "channel-16"), false);
  assert.equal(canToggleAgentPin(combined, "agent-1"), true);
  assert.equal(canToggleAgentPin(combined, "channel-1"), true);
  const fullWithLead = save((current) => withLeadAgent(current, "agent-2"));
  assert.equal(fullWithLead.leadAgentId, "agent-2");
  assert.deepEqual(fullWithLead.pinned, full.pinned);
  assert.deepEqual(fullWithLead.pinnedChannels, channelPins);
  assert.equal(fullWithLead.pinned.length + (fullWithLead.pinnedChannels?.length ?? 0), 16);
  assert.equal(reopen().read(host).leadAgentId, "agent-2");
  checks.push("The shared 16-pin limit stays in place; a separate lead choice does not consume a pin slot.");

  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "report.json"), `${JSON.stringify({ passed: true, checks }, null, 2)}\n`);
  process.stdout.write(`Passed ${checks.length} preference-service flows. Report: ${join(output, "report.json")}\n`);
} catch (error) {
  mkdirSync(output, { recursive: true });
  writeFileSync(
    join(output, "report.json"),
    `${JSON.stringify({ passed: false, checks, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`,
  );
  throw error;
}
