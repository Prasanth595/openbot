import { describe, expect, it } from "vitest";
import {
  decodeMemoryDirectoryMetadataFromHost,
  decodeOptionalMemoryDirectoryMetadataFromHost,
} from "./remote-memory-directory-decoding";

const publicMetadata = {
  memoryId: "memory-fixture",
  memoryRevision: 3,
  directoryRevision: null,
  annotationRevision: null,
  title: "Current text hint",
  titleKind: "current-text-excerpt",
  aliases: [],
  actor: null,
  annotationUserControlled: false,
};

describe("memory directory host boundary", () => {
  it("projects only public fields from a known host response", () => {
    expect(decodeMemoryDirectoryMetadataFromHost({ ...publicMetadata, memoryTextDigest: "private-binding" })).toEqual(
      publicMetadata,
    );
  });
  it("fails closed for malformed metadata without changing optional null behavior", () => {
    expect(decodeOptionalMemoryDirectoryMetadataFromHost(null)).toBeNull();
    expect(() => decodeMemoryDirectoryMetadataFromHost({ ...publicMetadata, titleKind: "invented" })).toThrow();
    expect(() =>
      decodeMemoryDirectoryMetadataFromHost({ ...publicMetadata, annotationUserControlled: "yes" }),
    ).toThrow();
    expect(() => decodeMemoryDirectoryMetadataFromHost({ ...publicMetadata, memoryId: "" })).toThrow();
  });
});
