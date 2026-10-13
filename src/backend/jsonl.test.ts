// @vitest-environment node

import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect, it, vi } from "vitest";
import { JsonLineDecoder, limitLineLength } from "./jsonl";

describe("limitLineLength", () => {
  it.each([
    { name: "first", chunks: [Buffer.from("12345\na\n")] },
    { name: "interior", chunks: [Buffer.from("a\n123456\nb\n")] },
    { name: "last terminated", chunks: [Buffer.from("a\n12345\n")] },
    { name: "last unterminated", chunks: [Buffer.from("a\n12345")] },
    { name: "fragmented unterminated", chunks: [Buffer.from("1234"), Buffer.from("5")] },
    { name: "fragmented terminated", chunks: [Buffer.from("1234"), Buffer.from("5\na\n")] },
    { name: "interior after a fragment", chunks: [Buffer.from("a"), Buffer.from("\n12345\nb\n")] },
    { name: "UTF-8", chunks: [Buffer.from("a\nééé\nb\n")] },
    { name: "fragmented UTF-8", chunks: [Buffer.from([0xc3]), Buffer.from([0xa9, 0xc3, 0xa9, 0xc3, 0xa9, 0x0a])] },
  ])("rejects oversized $name lines with the supplied error", async ({ chunks }) => {
    const error = new Error("Line exceeds the byte limit");
    const overflow = vi.fn(() => error);
    const output: Buffer[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        output.push(chunk);
        callback();
      },
    });

    await expect(pipeline(Readable.from(chunks), limitLineLength(overflow, 4), destination)).rejects.toBe(error);
    expect(overflow).toHaveBeenCalledTimes(1);
    expect(Buffer.concat(output)).toEqual(Buffer.concat(chunks.slice(0, -1)));
  });

  it("forwards valid chunks byte for byte at the exact limit", async () => {
    const chunks = [
      Buffer.from("\n1234\n\na\r\n123"),
      Buffer.from([0x34, 0x0a, 0xc3]),
      Buffer.from([0xa9, 0xc3, 0xa9, 0x0a, 0x0a, 0xff, 0x00, 0xfe, 0x01]),
    ];
    const overflow = vi.fn(() => new Error("Line exceeds the byte limit"));
    const output: Buffer[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        output.push(chunk);
        callback();
      },
    });

    await pipeline(Readable.from(chunks), limitLineLength(overflow, 4), destination);
    expect(output).toEqual(chunks);
    expect(Buffer.concat(output)).toEqual(Buffer.concat(chunks));
    expect(overflow).not.toHaveBeenCalled();
  });
});

describe("JsonLineDecoder", () => {
  it("decodes fragmented and coalesced JSONL messages", () => {
    const decoder = new JsonLineDecoder();

    expect(decoder.push('{"id":1,"res')).toEqual([]);
    expect(decoder.push('ult":{"ok":true}}\n{"method":"turn/started","params":{"id":"t1"}}\n')).toEqual([
      { id: 1, result: { ok: true } },
      { method: "turn/started", params: { id: "t1" } },
    ]);
  });

  it("preserves a split multibyte character", () => {
    const decoder = new JsonLineDecoder();
    const payload = Buffer.from('{"method":"message","params":{"text":"cześć"}}\n');
    const splitAt = payload.indexOf(Buffer.from("ś")) + 1;

    expect(decoder.push(payload.subarray(0, splitAt))).toEqual([]);
    expect(decoder.push(payload.subarray(splitAt))).toEqual([{ method: "message", params: { text: "cześć" } }]);
  });

  it("rejects malformed lines", () => {
    const decoder = new JsonLineDecoder();
    expect(() => decoder.push("not-json\n")).toThrow("Invalid JSONL");
  });
});
