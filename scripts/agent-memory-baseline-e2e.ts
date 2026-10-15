// Research baseline for #660. Drives the production SQLite database and memory store with
// synthetic records only. No provider, app, external session, credential or network access.
// Run: bun scripts/agent-memory-baseline-e2e.ts
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { essentialMemoryBytes } from "@openbot/contracts/agent-memory-context";
import type { AgentMemory } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { memoryContext, memoryContextUpdate } from "../src/backend/agent/developer-instructions";
import { AgentMemoryStore } from "../src/backend/agent-memory-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const output = resolve(import.meta.dirname, "../.openbot-build/agent-memory-baseline-e2e/report.json");
const temporary = await mkdtemp(join(tmpdir(), "openbot-memory-baseline-"));
const database = new OpenBotDatabase(temporary);
const report: {
  schemaVersion: number;
  passed: boolean;
  runtime: { bunVersion: string | null; nodeCompatibilityVersion: string; platform: string; architecture: string };
  scope: string;
  checks: string[];
  corpora: CorpusReport[];
  error?: string;
} = {
  schemaVersion: 1,
  passed: false,
  runtime: {
    bunVersion: process.versions.bun ?? null,
    nodeCompatibilityVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  scope: "Production memory store and prompt serializer. Synthetic local SQLite only. No model or transport.",
  checks: [],
  corpora: [],
};

interface CorpusReport {
  records: number;
  corpusBytes: number;
  essentialBytes: number;
  fullMemoryTurnBytes: number;
  recall: { query: string; category: "literal" | "nonliteral"; targetFound: boolean; returned: number }[];
  searchMilliseconds: { samples: number; p50: number; p95: number };
  maintenancePages: number;
}

const fixtures = [
  { text: "Pasta is the owner's preferred lunch.", literal: "Pasta", nonliteral: "favored noodles" },
  {
    text: "The owner chose Boreal because it keeps data on the VPS.",
    literal: "Boreal",
    nonliteral: "hosting decision",
  },
  { text: "The project's café review happens on Friday.", literal: "café", nonliteral: "coffee evaluation" },
  { text: "11월 제주도로 가족 여행을 가기로 결정했다.", literal: "제주도로", nonliteral: "제주" },
  { text: "资料归档保存在个人服务器。", literal: "资料归档保存在个人服务器", nonliteral: "私人知识库" },
  { text: "来月は東京で会議に参加します。", literal: "来月は東京で会議に参加します", nonliteral: "東京" },
] as const;

function requiredMemory(store: AgentMemoryStore, agentId: string, memoryId: string): AgentMemory {
  const memory = store.get(agentId, memoryId);
  assert.ok(memory, "The synthetic memory must exist.");
  return memory;
}

function selectEssential(store: AgentMemoryStore, agentId: string, memories: AgentMemory[]): void {
  store.setInclusions(
    agentId,
    memories.map((memory) => {
      const selection = store.getSelection(agentId, memory.id);
      assert.ok(selection);
      return { memoryId: memory.id, inclusion: "essential", expectedRevision: selection.revision };
    }),
    "user",
  );
}

function check(name: string, operation: () => void): void {
  operation();
  report.checks.push(name);
}

function benchmark(store: AgentMemoryStore, agentId: string): CorpusReport["searchMilliseconds"] {
  for (let warmup = 0; warmup < 5; warmup += 1) store.search(agentId, "Boreal");
  const timings: number[] = [];
  for (let sample = 0; sample < 30; sample += 1) {
    const start = performance.now();
    store.search(agentId, "Boreal");
    timings.push(performance.now() - start);
  }
  timings.sort((left, right) => left - right);
  const quantile = (fraction: number) => timings[Math.ceil(timings.length * fraction) - 1] ?? 0;
  return { samples: timings.length, p50: quantile(0.5), p95: quantile(0.95) };
}

try {
  await Effect.runPromise(database.initialize());
  const store = new AgentMemoryStore(database, () => 512);
  const privateMemory = store.createManual(
    "synthetic-other-agent",
    "Boreal private fixture belonging to another agent.",
  );

  for (const size of [64, 128, 512]) {
    const agentId = `synthetic-agent-${size}`;
    const memories = fixtures.map((fixture) => store.createManual(agentId, fixture.text));
    for (let index = memories.length; index < size; index += 1) {
      store.createManual(
        agentId,
        `Archive item ${index}: the fixture topic${index} records a synthetic decision. ${"Bounded reference detail. ".repeat(9)}`,
      );
    }
    selectEssential(store, agentId, memories.slice(0, 2));
    const all = store.list(agentId);
    const essential = all.filter((memory) => store.getSelection(agentId, memory.id)?.inclusion === "essential");
    const context = memoryContext(essential, { storedMemoryCount: size, memoryLimit: 512 });
    const fullTurn = memoryContextUpdate(null, context);
    assert.ok(fullTurn);

    const recall: CorpusReport["recall"] = [];
    for (const [index, fixture] of fixtures.entries()) {
      const target = memories[index];
      assert.ok(target);
      for (const category of ["literal", "nonliteral"] as const) {
        const query = fixture[category];
        const result = store.search(agentId, query, 5);
        const targetFound = result.memories.some((memory) => memory.id === target.id);
        if (category === "literal") assert.equal(targetFound, true, "Literal fixture recall must work.");
        assert.equal(
          result.memories.some((memory) => memory.id === privateMemory.id),
          false,
        );
        assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= 8192);
        recall.push({ query, category, targetFound, returned: result.memories.length });
      }
    }

    const listed = new Set<string>();
    let after: string | null = null;
    let pages = 0;
    do {
      const page = store.listPage(agentId, after);
      pages += 1;
      assert.ok(page.memories.length > 0);
      assert.ok(Buffer.byteLength(JSON.stringify(page), "utf8") <= 8192);
      for (const memory of page.memories) {
        assert.equal(listed.has(memory.id), false, "Maintenance pages must not repeat a memory.");
        listed.add(memory.id);
      }
      after = page.nextCursor;
      assert.ok(pages <= size, "Paging must advance.");
    } while (after !== null);
    assert.equal(listed.size, size);
    assert.ok(essentialMemoryBytes(essential) <= 8192);
    report.corpora.push({
      records: size,
      corpusBytes: Buffer.byteLength(JSON.stringify(all), "utf8"),
      essentialBytes: essentialMemoryBytes(essential),
      fullMemoryTurnBytes: Buffer.byteLength(fullTurn, "utf8"),
      recall,
      searchMilliseconds: benchmark(store, agentId),
      maintenancePages: pages,
    });
  }
  report.checks.push(
    "Literal recall, agent isolation, bounded recall, complete paging and bounded selection at 64/128/512 records.",
  );

  const agentId = "synthetic-corrections";
  const original = store.saveAutomatic({
    agentId,
    text: "Aurora opens on Tuesday.",
    sourceTurnId: "synthetic-turn-one",
  });
  assert.ok(original);
  const originalSelection = store.getSelection(agentId, original.id);
  assert.ok(originalSelection);
  const corrected = store.updateManual(agentId, original.id, "Aurora opens on Thursday.");
  check("A user correction clears the current turn provenance and changes the search index.", () => {
    assert.equal(corrected.sourceTurnId, null);
    assert.equal(store.search(agentId, "Tuesday").memories.length, 0);
    assert.equal(store.search(agentId, "Thursday").memories[0]?.id, corrected.id);
  });
  check("A stale automatic revision cannot restore the older fact.", () => {
    assert.equal(
      store.saveAutomatic({
        agentId,
        memoryId: original.id,
        text: original.text,
        sourceTurnId: "synthetic-old-review",
        expectedUpdatedAt: original.updatedAt,
        expectedSelectionRevision: originalSelection.revision,
      }),
      null,
    );
    assert.equal(requiredMemory(store, agentId, original.id).text, corrected.text);
  });
  check("An exact duplicate save retains one record.", () => {
    const duplicate = store.createManual(agentId, corrected.text);
    assert.equal(duplicate.id, corrected.id);
    assert.equal(store.count(agentId), 1);
  });

  database.close();
  await Effect.runPromise(database.initialize());
  check("A database close and reopen retains current text and indexed recall.", () => {
    assert.equal(requiredMemory(store, agentId, original.id).text, corrected.text);
    assert.equal(store.search(agentId, "Thursday").memories[0]?.id, original.id);
  });
  check("Forget removes current text, selection, indexed recall and retained event/receipt text.", () => {
    assert.equal(store.delete(agentId, original.id), true);
    assert.equal(store.get(agentId, original.id), null);
    assert.equal(store.getSelection(agentId, original.id), null);
    assert.equal(store.search(agentId, "Aurora").memories.length, 0);
    const events = database.connection.prepare("SELECT payload_json FROM orchestration_events").all();
    const receipts = database.connection.prepare("SELECT result_json FROM orchestration_command_receipts").all();
    for (const rows of [events, receipts]) assert.equal(JSON.stringify(rows).includes("Aurora"), false);
  });
  check("Clear removes all memories of one owner and preserves other owners.", () => {
    assert.equal(store.clear("synthetic-agent-64"), 64);
    assert.equal(store.count("synthetic-agent-64"), 0);
    assert.equal(store.search("synthetic-agent-64", "Boreal").memories.length, 0);
    assert.equal(store.count("synthetic-agent-128"), 128);
    assert.equal(store.get("synthetic-other-agent", privateMemory.id)?.id, privateMemory.id);
  });
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : "The memory baseline failed.";
  throw error;
} finally {
  database.close();
  await mkdir(join(output, ".."), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  await rm(temporary, { recursive: true, force: true });
}

// Machine-readable: the repeatable report path for the root validation harness.
process.stdout.write(`${JSON.stringify({ passed: report.passed, report: output })}\n`);
