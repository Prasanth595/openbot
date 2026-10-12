import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { z } from "zod";

const handoff = {
  recipientAgentId: z.string(),
  task: z.string().min(1).max(INPUT_LIMITS.messageText),
  expectedResult: z.string().min(1).max(INPUT_LIMITS.messageText),
  sourceMessageIds: z.array(z.string()).min(1),
  resources: z
    .array(z.string())
    .describe(
      "Use host for exclusive work, browser for the shared browser, or workspace:<absolute path>. Omission reserves the host. Use none only for work that does not use files or the browser. Declare every resource the task will use.",
    )
    .optional(),
  dependencies: z.array(z.string()).optional(),
};

const channelName = z
  .string()
  .describe(
    "The id or name of a channel that you are a member of. Needed outside a channel task, unless you belong to one channel only.",
  )
  .optional();

export const CHANNEL_TOOL_DEFINITIONS: readonly { name: string; description: string; shape: z.ZodRawShape }[] = [
  {
    name: "channel_history",
    description:
      "Read earlier shared channel messages. This never starts another agent. A channel member can also use it in a direct chat.",
    shape: {
      beforeSequence: z.number().int().min(0).optional(),
      attachmentId: z.string().optional(),
      channel: channelName,
    },
  },
  {
    name: "channel_assign",
    description:
      "Assign one specific subtask to another channel member. You stay the owner: integrate the result and report to the user. End your turn while waiting for required results. Use only inside a channel task; for direct teammate work outside a channel use openbot.send_message.",
    shape: handoff,
  },
  {
    name: "channel_transfer",
    description:
      "Transfer this whole task to another channel member. You stop working on it. End your turn after the transfer.",
    shape: handoff,
  },
  {
    name: "channel_result",
    description:
      "Publish the requested task result once in the shared chat when answering an assigned or transferred task. End your turn without repeating it.",
    shape: { text: z.string().min(1).max(INPUT_LIMITS.messageText) },
  },
  {
    name: "channel_remember",
    description:
      "Save one short, durable fact about this channel that every member should keep. Save the same text again to correct it. This writes immediately. A channel member can also use it in a direct chat, when a person asks.",
    shape: { text: z.string().min(1).max(INPUT_LIMITS.agentMemoryText), channel: channelName },
  },
  {
    name: "channel_forget_memory",
    description:
      "Delete one saved channel memory when the user asks the channel to forget it. Give its text exactly as it is listed.",
    shape: { text: z.string().min(1).max(INPUT_LIMITS.agentMemoryText), channel: channelName },
  },
];
