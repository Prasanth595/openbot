// Checks the queue reads of an agent with a long mailbox history (#2240). Runs the real mailbox
// store and SQLite on a temporary profile, with many messages and many deliveries to one agent.
// Checks that `listQueue`, `senderAgentIdsForRecipient` and `conversationMessages` give the rows of
// the seeded messages, and records the time of the reads that each queue change makes. No app,
// provider, account or network is started.
//
// Run: bun scripts/mailbox-queue-scale-e2e.ts
// Writes .openbot-build/mailbox-queue-scale-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/mailbox-queue-scale-e2e");
const AGENT = "agent-a";
const OTHER_AGENT = "agent-b";
const SENDERS = ["sender-0", "sender-1", "sender-2", "sender-3"];
const SEEDED_MESSAGES = 10_000;
/** Each fifth message goes to `AGENT`, so it has 2,000 deliveries. */
const AGENT_EVERY = 5;
const COMPLETED = 1_000;
const TIMED_READS = 20;

interface Report {
  seededMessages: number;
  agentDeliveries: number;
  completedDeliveries: number;
  checks: string[];
  timing?: { reads: number; totalMs: number; perQueueChangeMs: number };
  passed: boolean;
}

const report: Report = {
  seededMessages: SEEDED_MESSAGES,
  agentDeliveries: 0,
  completedDeliveries: COMPLETED,
  checks: [],
  passed: false,
};

interface Seeded {
  deliveryId: string;
  messageId: string;
  sender: string;
  text: string;
}

async function seed(mailbox: MailboxStore): Promise<Seeded[]> {
  const seeded: Seeded[] = [];
  for (let index = 0; index < SEEDED_MESSAGES; index += 1) {
    const toAgent = index % AGENT_EVERY === 0;
    const sender = SENDERS[index % SENDERS.length] ?? "sender-0";
    const text = `message ${index}`;
    const receipt = await runCauseEffect(
      mailbox.enqueue(
        toAgent
          ? { sender: { kind: "agent", agentId: sender }, recipientAgentIds: [AGENT], text }
          : { sender: { kind: "user" }, recipientAgentIds: [OTHER_AGENT], text },
      ),
    );
    if (!toAgent) continue;
    const delivery = receipt.deliveries.find((candidate) => candidate.recipientAgentId === AGENT);
    assert.ok(delivery);
    seeded.push({ deliveryId: delivery.id, messageId: receipt.messageId, sender, text });
  }
  for (const item of seeded.slice(0, COMPLETED)) {
    await runCauseEffect(mailbox.markStarting(item.deliveryId));
    await runCauseEffect(mailbox.markTerminal(item.deliveryId, "completed"));
  }
  return seeded;
}

function checkQueue(mailbox: MailboxStore, seeded: Seeded[]): void {
  const queue = mailbox.listQueue(AGENT);
  assert.equal(queue.agentId, AGENT);
  assert.deepEqual(
    queue.deliveries.map((delivery) => delivery.id),
    seeded.map((item) => item.deliveryId),
    "The queue lists every delivery of the agent, the completed ones too, in queue order.",
  );
  queue.deliveries.forEach((delivery, index) => {
    const item = seeded[index];
    assert.ok(item);
    assert.deepEqual(delivery.sender, { kind: "agent", agentId: item.sender });
    assert.equal(delivery.text, item.text);
    const completed = index < COMPLETED;
    assert.equal(delivery.status, completed ? "completed" : "queued");
    assert.equal(delivery.position, completed ? null : index - COMPLETED + 1);
  });
  report.checks.push(`listQueue: ${queue.deliveries.length} deliveries with their message sender, text and position`);

  assert.deepEqual(mailbox.senderAgentIdsForRecipient(AGENT).sort(), [...SENDERS].sort());
  assert.deepEqual(mailbox.senderAgentIdsForRecipient(OTHER_AGENT), []);
  report.checks.push("senderAgentIdsForRecipient: the agent senders of each recipient");

  const byDelivery = new Map(seeded.map((item) => [item.deliveryId, item]));
  const rows = mailbox.conversationMessages(AGENT).filter((row) => row.delivery);
  assert.ok(rows.length > 0);
  for (const row of rows) {
    const item = byDelivery.get(row.id);
    assert.ok(item, `The conversation row ${row.id} is a delivery to the agent.`);
    assert.equal(row.text, item.text);
    assert.equal(row.senderAgentId, item.sender);
    assert.equal(row.exchange?.messageId, item.messageId);
    assert.deepEqual(
      row.exchange?.deliveries.map((delivery) => delivery.id),
      [item.deliveryId],
    );
  }
  report.checks.push(`conversationMessages: ${rows.length} rows with their message text and sender`);
}

/** The reads `MailboxSync.emitQueue` makes on each queue change. */
function timeQueueChanges(mailbox: MailboxStore): NonNullable<Report["timing"]> {
  const started = performance.now();
  for (let index = 0; index < TIMED_READS; index += 1) {
    mailbox.listQueue(AGENT);
    mailbox.senderAgentIdsForRecipient(AGENT);
  }
  const totalMs = performance.now() - started;
  return {
    reads: TIMED_READS,
    totalMs: Math.round(totalMs),
    perQueueChangeMs: Number((totalMs / TIMED_READS).toFixed(2)),
  };
}

const root = await mkdtemp(join(tmpdir(), "openbot-mailbox-queue-scale-"));
const path = join(root, "profile");
const database = new OpenBotDatabase(path);
try {
  const mailbox = new MailboxStore(path, join(root, "shared"), database);
  await runCauseEffect(mailbox.initialize());
  const seeded = await seed(mailbox);
  report.agentDeliveries = seeded.length;
  checkQueue(mailbox, seeded);
  report.timing = timeQueueChanges(mailbox);
  report.passed = true;
} finally {
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(
  `${report.passed ? "PASS" : "FAIL"}: ${report.checks.length} checks, ${report.timing?.perQueueChangeMs} ms per queue change. ` +
    `Report: ${join(OUT, "report.json")}\n`,
);
if (!report.passed) process.exitCode = 1;
