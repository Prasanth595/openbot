import { INPUT_LIMITS } from "./input-limits";
import type { AgentMemory } from "./ipc-agent-memories";
import { isDynamicRecord, isString } from "./runtime-values";

export const MEMORY_DIRECTORY_LIMITS = {
  title: 96,
  aliases: 4,
  alias: 64,
  annotationBytes: 512,
  query: 256,
  cursor: 1024,
  scan: 25,
  filteredScan: 512,
  responseBytes: 4096,
} as const;

export interface MemoryDirectoryAnnotation {
  title: string | null;
  aliases: readonly string[];
}

export interface MemoryDirectoryEntry {
  memoryId: string;
  memoryRevision: number;
  directoryRevision: number | null;
  title: string;
  titleKind: "explicit" | "current-text-excerpt";
  aliases: readonly string[];
}

export interface AgentMemoryDirectoryMetadata extends MemoryDirectoryEntry {
  /** Current annotation revision, including a stale or removed label. Used only by the editor. */
  annotationRevision: number | null;
  actor: "user" | "agent" | null;
  annotationUserControlled: boolean;
}

export interface GetAgentMemoryDirectoryInput {
  agentId: string;
  memoryId: string;
}

export interface SetAgentMemoryDirectoryInput extends GetAgentMemoryDirectoryInput, MemoryDirectoryAnnotation {
  expectedMemoryRevision: number;
  expectedAnnotationRevision: number | null;
}

export interface MemoryDirectoryPage {
  entries: MemoryDirectoryEntry[];
  searchableCount: number;
  /** Inspected rows in this call, including an overflow match reconsidered on the next page. */
  scanned: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export type MemoryDirectoryRead =
  | { status: "missing" }
  | { status: "stale" }
  | {
      status: "ok";
      memory: AgentMemory;
      inclusion: "essential" | "searchable";
      userControlled: boolean;
      memoryRevision: number;
      directoryRevision: number | null;
    };

/** Literal matching is normalized, but it does not translate or infer a subject. */
export function normalizeMemoryDirectoryQuery(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

export function memoryDirectoryAnnotationBytes(annotation: MemoryDirectoryAnnotation): number {
  return new TextEncoder().encode(JSON.stringify({ title: annotation.title, aliases: annotation.aliases })).byteLength;
}

export function isMemoryDirectoryAnnotation(value: unknown): value is MemoryDirectoryAnnotation {
  return (
    isDynamicRecord(value) &&
    (value.title === null ||
      (isString(value.title) && value.title.length > 0 && value.title.length <= MEMORY_DIRECTORY_LIMITS.title)) &&
    Array.isArray(value.aliases) &&
    value.aliases.length <= MEMORY_DIRECTORY_LIMITS.aliases &&
    value.aliases.every(
      (alias: unknown) => isString(alias) && alias.length > 0 && alias.length <= MEMORY_DIRECTORY_LIMITS.alias,
    ) &&
    (value.title !== null || value.aliases.length === 0) &&
    memoryDirectoryAnnotationBytes({ title: value.title, aliases: value.aliases }) <=
      MEMORY_DIRECTORY_LIMITS.annotationBytes
  );
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isAgentMemoryDirectoryMetadata(value: unknown): value is AgentMemoryDirectoryMetadata {
  return (
    isDynamicRecord(value) &&
    isString(value.memoryId) &&
    value.memoryId.length > 0 &&
    value.memoryId.length <= INPUT_LIMITS.identifier &&
    isRevision(value.memoryRevision) &&
    (value.directoryRevision === null || isRevision(value.directoryRevision)) &&
    (value.annotationRevision === null || isRevision(value.annotationRevision)) &&
    isString(value.title) &&
    value.title.length <= MEMORY_DIRECTORY_LIMITS.title &&
    (value.titleKind === "explicit" || value.titleKind === "current-text-excerpt") &&
    Array.isArray(value.aliases) &&
    value.aliases.length <= MEMORY_DIRECTORY_LIMITS.aliases &&
    value.aliases.every(
      (alias: unknown) => isString(alias) && alias.length > 0 && alias.length <= MEMORY_DIRECTORY_LIMITS.alias,
    ) &&
    (value.actor === null || value.actor === "user" || value.actor === "agent") &&
    typeof value.annotationUserControlled === "boolean" &&
    (!value.annotationUserControlled || value.actor === "user") &&
    (value.titleKind === "explicit"
      ? value.title.length > 0 &&
        value.directoryRevision !== null &&
        value.directoryRevision === value.annotationRevision &&
        value.actor !== null
      : value.directoryRevision === null && value.aliases.length === 0)
  );
}
