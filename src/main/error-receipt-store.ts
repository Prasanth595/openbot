import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  type ErrorReceipt,
  type ErrorReceiptBatch,
  type ErrorReceiptInput,
  type ErrorReceiptQuery,
  RECEIPT_CURSOR_PATTERN,
  RECEIPT_ID_PATTERN,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Schema } from "effect";
import { parseErrorReceiptInput } from "./ipc/notification-inputs";

class ErrorReceiptFailure extends Schema.TaggedError<ErrorReceiptFailure>()("ErrorReceiptFailure", {}) {}

interface ReceiptLimits {
  maxBytes?: number;
  maxCount?: number;
  maxAgeMs?: number;
  now?: () => number;
}

/** One main-process owner. Each operation commits a bounded snapshot before returning. */
export class ErrorReceiptStore {
  #epoch: string = randomUUID();
  #sequence = 0;
  #floor = 0;
  #records: ErrorReceipt[] = [];
  #loaded = false;
  readonly #maxBytes: number;
  readonly #maxCount: number;
  readonly #maxAge: number;
  readonly #now: () => number;

  constructor(
    readonly path: string,
    limits: ReceiptLimits = {},
  ) {
    this.#maxBytes = limits.maxBytes ?? 512 * 1024;
    this.#maxCount = limits.maxCount ?? 1_000;
    this.#maxAge = limits.maxAgeMs ?? 7 * 24 * 60 * 60 * 1_000;
    this.#now = limits.now ?? Date.now;
  }

  readonly record = Effect.fn("ErrorReceipt.record")(function* (this: ErrorReceiptStore, input: ErrorReceiptInput) {
    return yield* this.#operation(() => {
      this.#load();
      const receipt: ErrorReceipt = {
        ...parseErrorReceiptInput(input),
        id: `rcpt_${randomUUID()}`,
        cursor: `${this.#epoch}:${++this.#sequence}`,
        timestamp: this.#now(),
      };
      this.#records.push(receipt);
      this.#prune();
      this.#save();
      return receipt;
    });
  });

  readonly read = Effect.fn("ErrorReceipt.read")(function* (this: ErrorReceiptStore, query: ErrorReceiptQuery) {
    return yield* this.#operation((): ErrorReceiptBatch => {
      this.#load();
      this.#prune();
      this.#save();
      const [epoch, raw] = query.after?.split(":") ?? [];
      const sequence = Number(raw);
      const gap =
        query.after === undefined
          ? this.#floor > 0
          : epoch !== this.#epoch || sequence < this.#floor || sequence > this.#sequence;
      const after = query.after === undefined || gap ? this.#floor : sequence;
      const remaining = this.#records.filter((record) => this.#number(record) > after);
      const records = remaining.slice(0, Math.max(1, Math.min(50, query.limit ?? 50)));
      return {
        records,
        cursor: records.at(-1)?.cursor ?? `${this.#epoch}:${this.#sequence}`,
        gap,
        hasMore: remaining.length > records.length,
      };
    });
  });

  #operation<A>(operation: () => A): Effect.Effect<A, ErrorReceiptFailure> {
    return Effect.try({
      try: operation,
      catch: () => {
        // Reload the committed snapshot after an I/O failure. No payload or private cause escapes.
        this.#loaded = false;
        return new ErrorReceiptFailure({});
      },
    });
  }

  #number(record: ErrorReceipt): number {
    return Number(record.cursor.split(":")[1]);
  }

  #load(): void {
    if (this.#loaded) return;
    this.#records = [];
    if (existsSync(this.path)) {
      const [header, ...lines] = readFileSync(this.path, "utf8").trim().split("\n");
      const state = JSON.parse(header ?? "null");
      if (
        !isDynamicRecord(state) ||
        state.version !== 1 ||
        typeof state.epoch !== "string" ||
        !RECEIPT_CURSOR_PATTERN.test(`${state.epoch}:0`) ||
        !Number.isSafeInteger(state.sequence) ||
        !Number.isSafeInteger(state.floor) ||
        typeof state.sequence !== "number" ||
        typeof state.floor !== "number" ||
        state.floor < 0 ||
        state.sequence < state.floor
      )
        throw new Error("Invalid receipt state");
      this.#epoch = state.epoch;
      this.#sequence = state.sequence;
      this.#floor = state.floor;
      const archive = existsSync(`${this.path}.1`) ? readFileSync(`${this.path}.1`, "utf8").trim().split("\n") : [];
      const retained = new Map<number, ErrorReceipt>();
      for (const line of [...archive, ...lines]) {
        if (!line) continue;
        const value = JSON.parse(line);
        if (
          !isDynamicRecord(value) ||
          typeof value.id !== "string" ||
          !RECEIPT_ID_PATTERN.test(value.id) ||
          typeof value.cursor !== "string" ||
          !RECEIPT_CURSOR_PATTERN.test(value.cursor) ||
          !value.cursor.startsWith(`${this.#epoch}:`) ||
          typeof value.timestamp !== "number" ||
          !Number.isFinite(value.timestamp)
        )
          continue;
        const metadata = parseErrorReceiptInput({
          presentation: value.presentation,
          operation: value.operation,
          cause: value.cause,
        });
        const record = { ...metadata, id: value.id, cursor: value.cursor, timestamp: value.timestamp };
        const sequence = this.#number(record);
        if (sequence > this.#floor && sequence <= this.#sequence) retained.set(sequence, record);
      }
      // Keep only a contiguous suffix. An interrupted rotation must produce a gap, not silent loss.
      for (let sequence = this.#sequence; sequence > this.#floor; sequence--) {
        const record = retained.get(sequence);
        if (!record) {
          this.#floor = sequence;
          break;
        }
        this.#records.unshift(record);
      }
    }
    this.#loaded = true;
  }

  #prune(): void {
    const cutoff = this.#now() - this.#maxAge;
    while (
      this.#records.length &&
      (this.#records.length > this.#maxCount ||
        (this.#records[0]?.timestamp ?? 0) < cutoff ||
        Buffer.byteLength(this.#records.map((record) => JSON.stringify(record)).join("\n")) + 256 > this.#maxBytes)
    ) {
      const removed = this.#records.shift();
      if (removed) this.#floor = this.#number(removed);
    }
  }

  #save(): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const lines = this.#records.map((record) => `${JSON.stringify(record)}\n`);
    let bytes = 0;
    let split = lines.length;
    while (split > 0 && bytes + Buffer.byteLength(lines[split - 1] ?? "") < this.#maxBytes / 2) {
      bytes += Buffer.byteLength(lines[--split] ?? "");
    }
    const header = `${JSON.stringify({ version: 1, epoch: this.#epoch, sequence: this.#sequence, floor: this.#floor })}\n`;
    this.#replace(`${this.path}.1`, lines.slice(0, split).join(""));
    this.#replace(this.path, header + lines.slice(split).join(""));
  }

  #replace(path: string, text: string): void {
    writeFileSync(`${path}.tmp`, text, { mode: 0o600 });
    chmodSync(`${path}.tmp`, 0o600);
    renameSync(`${path}.tmp`, path);
  }
}

/** Native startup can fail before application services exist. Receipt failure must not hide the box. */
export async function showStartupErrorReceipt(store: ErrorReceiptStore, show: (id?: string) => void): Promise<void> {
  const receipt = await Effect.runPromise(
    store.record({ presentation: "native_error_box", operation: "other", cause: "unknown" }),
  ).catch(() => undefined);
  show(receipt?.id);
}
