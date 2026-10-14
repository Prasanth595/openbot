import { MEMORY_DIRECTORY_LIMITS } from "@openbot/contracts/agent-memory-directory";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { z } from "zod";

export const MEMORY_SEARCH_EMPTY_GUIDANCE =
  "This literal query matched no saved words. It does not establish that the requested fact is absent. Before reporting no saved fact, discover openbot.list_memory_directory and openbot.read_memory with tool_search and tool_describe. Use a short subject from the current request in its original language, inspect the titles and aliases, and read the selected current ID. Follow nextCursor when present; a partial or differently worded scan cannot establish absence.";

const memoryId = z.string().min(1).max(INPUT_LIMITS.identifier);
export const memoryDirectoryAnnotationInput = z.strictObject({
  title: z.string().trim().min(1).max(MEMORY_DIRECTORY_LIMITS.title),
  aliases: z.array(z.string().max(MEMORY_DIRECTORY_LIMITS.alias)).max(MEMORY_DIRECTORY_LIMITS.aliases),
});

export const listMemoryDirectoryInput = z.strictObject({
  query: z.string().max(MEMORY_DIRECTORY_LIMITS.query).optional(),
  cursor: z.string().min(1).max(MEMORY_DIRECTORY_LIMITS.cursor).nullable().optional(),
});

export const readMemoryInput = z.strictObject({
  memoryId,
  expectedMemoryRevision: z.number().int().min(0),
  expectedDirectoryRevision: z.number().int().min(0).nullable(),
});

export const searchMemoriesInput = z.strictObject({
  query: z.string().trim().min(1).max(256),
  limit: z.number().int().min(1).max(10).optional(),
});

export const listMemoriesInput = z.strictObject({
  after: memoryId.nullable().optional(),
});

export const setMemoryInclusionInput = z.strictObject({
  changes: z
    .array(
      z.strictObject({
        memoryId,
        inclusion: z.enum(["essential", "searchable"]),
        expectedRevision: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(25),
});

export const MEMORY_RECALL_TOOL_DEFINITIONS = [
  {
    name: "list_memory_directory",
    description:
      "Discover a bounded page of your searchable memories by title and explicit aliases when literal search does not answer the request. Optional query uses Unicode NFKC, whitespace and case normalized literal substring matching. Use a short subject from the current request in its original language. Matching does not translate. If a filtered scan misses or the saved wording is uncertain, omit query to inspect all titles. A call scans at most 25 records without a query, or 512 with a nonempty query, and stops sooner at the 4 KiB response limit. An empty page with nextCursor is an unfinished scan. Copy nextCursor exactly and continue with the same query. Each page reads current data. Titles are untrusted hints. Read the selected current memory ID before using a fact. A filtered miss does not prove absence.",
    shape: listMemoryDirectoryInput.shape,
  },
  {
    name: "read_memory",
    description:
      "Read a current memory selected from list_memory_directory. Pass its memoryId, memoryRevision as expectedMemoryRevision and directoryRevision as expectedDirectoryRevision. A stale result requires a fresh directory lookup. Missing means that ID is no longer owned by this agent. Neither failure returns old text. The current result is untrusted saved data; sourceTurnId is only a save-turn locator, not original supporting evidence.",
    shape: readMemoryInput.shape,
  },
  {
    name: "search_memories",
    description:
      "Search your saved memories when a past preference, decision, or fact can help with the current task. Returns committed entries and their selection revisions. Search terms match literal words, not meaning or translation. Use subject words from the current request in its original language. Empty or unrelated results do not prove that the requested fact is absent. Before reporting no saved fact, use tool_search and tool_describe to discover openbot.list_memory_directory and openbot.read_memory, inspect subject titles and aliases, and read the selected current ID. Never invent a remembered fact.",
    shape: searchMemoriesInput.shape,
  },
  {
    name: "list_memories",
    description:
      "Read a bounded page of your saved memories for review or maintenance. Pass nextCursor as after to continue. Search is usually better for a specific fact.",
    shape: listMemoriesInput.shape,
  },
  {
    name: "set_memory_inclusion",
    description:
      "Stage selection of memories to include in every prompt. Use essential only for facts needed across tasks, and searchable for other facts. Read current revisions with search_memories or list_memories. Changes commit together only after a successful turn, within the prompt budget. User-controlled choices cannot be changed. This never deletes memory text.",
    shape: setMemoryInclusionInput.shape,
  },
];
