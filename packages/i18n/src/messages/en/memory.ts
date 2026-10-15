import { defineMessages } from "../../message";

export const messages = defineMessages("memory", {
  "memory.title": "Memories",
  "memory.description": "Saved memories for {name}",
  "memory.add": "Add memory",
  "memory.close": "Close memories",
  "memory.new": "New memory",
  "memory.newPlaceholder": "Add a durable fact or preference",
  "memory.save": "Save memory",
  "memory.limitAgent":
    "This agent has reached the limit of {limit} memories. Edit, merge, or delete a memory before you add another one.",
  "memory.limitChannel":
    "This channel has reached the limit of {limit} memories. Edit, merge, or delete a memory before you add another one.",
  "memory.loading": "Loading memories…",
  "memory.emptyAgent": "This agent has no saved memories yet.",
  "memory.emptyChannel": "This channel has no saved memories yet.",
  "memory.editText": "Edit memory: {text}",
  "memory.edit": "Edit memory",
  "memory.delete": "Delete memory",
  "memory.learned": "Learned automatically",
  "memory.manual": "Added manually",
  "memory.unknownDate": "Unknown date",
  "memory.clearAll": "Clear all memories",
  "memory.clearTitle": "Clear all memories?",
  "memory.clearDescription":
    "OpenBot will permanently remove all {total} saved memories for {name}. Original messages will stay in the conversation history.",

  "memory.loadFailed": "Could not load memories.",
  "memory.saveFailed": "Could not save the memory.",
  "memory.updateFailed": "Could not update the memory.",
  "memory.deleteFailed": "Could not delete the memory.",
  "memory.clearFailed": "Could not clear the memories.",
  "memory.inclusion.label": "Memory use",
  "memory.inclusion.essential": "Always included",
  "memory.inclusion.searchable": "Search when needed",
  "memory.inclusion.automatic": "Let the agent decide",
  "memory.inclusion.userControlled": "Selected by you",
  "memory.inclusion.agentControlled": "Agent can change this",
  "memory.inclusion.explanation":
    "All memories stay saved. Only essential memories enter every prompt. The agent can search the others.",
  "memory.inclusion.capacity": "Essential memory capacity: {used} of {total}",
  "memory.directory.label": "Recall labels",
  "memory.directory.explanation":
    "Labels help this agent find a saved fact when needed. They do not enter every prompt.",
  "memory.directory.title": "Short title",
  "memory.directory.aliases": "Aliases",
  "memory.directory.aliasHelp":
    "Up to four literal aliases, one per line. Matching does not translate or infer meaning.",
  "memory.directory.fallback": "Current text is used as a hint. Save labels to describe this version.",
  "memory.directory.userLabels": "Labels saved by you. Automatic changes cannot replace them.",
  "memory.directory.agentLabels": "Labels saved by the agent.",
  "memory.directory.save": "Save labels",
  "memory.directory.remove": "Remove custom labels",
  "memory.directory.reload": "Reload labels",
  "memory.directory.loading": "Loading labels…",
  "memory.directory.loadFailed": "Could not load recall labels.",
  "memory.directory.saveFailed": "Could not save recall labels.",
  "memory.directory.invalid":
    "Use a title of up to 96 characters and four aliases of up to 64 characters. Keep the labels within 512 bytes.",
});
