import { describe, expect, it } from "vitest";
import {
  decodeMemoryDirectoryMetadataFromMain,
  decodeOptionalMemoryDirectoryMetadataFromMain,
} from "./memory-directory-decoding";

const publicMetadata = {
  memoryId: "memory-fixture",
  memoryRevision: 3,
  directoryRevision: 12,
  annotationRevision: 12,
  title: "Recall title",
  titleKind: "explicit",
  aliases: ["alias"],
  actor: "user",
  annotationUserControlled: true,
};

describe("memory directory preload boundary", () => {
  it("projects only public fields from a valid main response", () => {
    expect(
      decodeMemoryDirectoryMetadataFromMain({
        ...publicMetadata,
        memoryTextDigest: "private-binding",
        extra: "private",
      }),
    ).toEqual(publicMetadata);
  });
  it("accepts null only for the optional read and rejects malformed known metadata", () => {
    expect(decodeOptionalMemoryDirectoryMetadataFromMain(null)).toBeNull();
    expect(() => decodeMemoryDirectoryMetadataFromMain(null)).toThrow();
    expect(() => decodeMemoryDirectoryMetadataFromMain({ ...publicMetadata, aliases: ["x".repeat(65)] })).toThrow();
    expect(() => decodeMemoryDirectoryMetadataFromMain({ ...publicMetadata, memoryRevision: -1 })).toThrow();
    expect(() => decodeMemoryDirectoryMetadataFromMain({ ...publicMetadata, directoryRevision: 1.5 })).toThrow();
    expect(() => decodeMemoryDirectoryMetadataFromMain({ ...publicMetadata, actor: "caller-chosen" })).toThrow();
  });
});
