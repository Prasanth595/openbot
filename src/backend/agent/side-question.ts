import { CHAT_VISUAL_ITEM_TYPE_PREFIX } from "@openbot/contracts/chat-visual";
import {
  type AgentSummary,
  type AskSideQuestionInput,
  CONVERSATION_PLAN_ITEM_TYPE,
  type ConversationMessage,
  ROUTINE_QUIET_ANSWER_ITEM_TYPE,
} from "@openbot/contracts/ipc";

/** The chat messages a side question reads, newest last. */
export const SIDE_QUESTION_CHAT_MESSAGES = 60;
const MESSAGE_CHARACTERS = 4_000;
const CHAT_CHARACTERS = 60_000;

/** JSON for a prompt block. An escaped `<` keeps chat text from closing the block's tag. */
function tagSafe(value: unknown): string {
  return JSON.stringify(value, null, 2).replaceAll("<", "\\u003c");
}

/** A message that a person or the agent wrote in the chat, not a tool step or a status line. */
function chatMessage(message: ConversationMessage): boolean {
  return (
    (message.author === "user" || message.author === "assistant" || message.author === "agent") &&
    message.text.trim().length > 0 &&
    message.itemType !== "commentary" &&
    message.itemType !== "question_prompt" &&
    message.itemType !== "agent_attachment" &&
    !message.itemType?.startsWith(CHAT_VISUAL_ITEM_TYPE_PREFIX) &&
    message.itemType !== CONVERSATION_PLAN_ITEM_TYPE &&
    message.itemType !== ROUTINE_QUIET_ANSWER_ITEM_TYPE
  );
}

function chatTranscript(agent: AgentSummary, messages: readonly ConversationMessage[]) {
  const entries: { from: string; text: string }[] = [];
  let characters = 0;
  for (const message of [...messages].filter(chatMessage).reverse()) {
    const text = message.text.slice(0, MESSAGE_CHARACTERS);
    if (characters + text.length > CHAT_CHARACTERS) break;
    characters += text.length;
    const from =
      message.author === "user"
        ? (message.senderMember?.name ?? "User")
        : message.senderAgentId
          ? "Another agent"
          : agent.name;
    entries.push({ from, text });
  }
  return entries.reverse();
}

/**
 * The prompt of a side question: the agent's profile, the end of its chat, the earlier side turns, and
 * the question. The generation has no tools, so the answer can only come from this text.
 */
export function sideQuestionPrompt(
  agent: AgentSummary,
  messages: readonly ConversationMessage[],
  input: AskSideQuestionInput,
): string {
  return [
    "You are the agent in this profile. The user asks a side question about your chat with them. The question and your answer stay out of the chat, and you cannot use tools here. Answer from the chat and from what you know. Give the shortest complete answer in plain text or Markdown.",
    "<agent_profile>",
    tagSafe({
      name: agent.name,
      title: agent.title.trim() || "General assistant",
      description: agent.description.trim() || "No additional description configured.",
    }),
    "</agent_profile>",
    "<chat>",
    tagSafe(chatTranscript(agent, messages)),
    "</chat>",
    ...(input.earlier.length > 0
      ? ["<earlier_side_questions>", tagSafe(input.earlier), "</earlier_side_questions>"]
      : []),
    "<side_question>",
    tagSafe(input.question),
    "</side_question>",
  ].join("\n");
}
