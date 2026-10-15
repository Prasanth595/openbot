import { blockChatMath, chatMathBlockStart, chatMathStart, inlineChatMath } from "@openbot/contracts/chat-math";
import { chatTagReferences } from "@openbot/contracts/chat-tag-references";
import { Marked } from "marked";

const markdown = new Marked({
  gfm: true,
  breaks: true,
  extensions: [
    {
      name: "blockMath",
      level: "block",
      start: chatMathBlockStart,
      tokenizer(source) {
        const math = blockChatMath(source);
        if (math) return { type: "blockMath", raw: math.raw, text: math.tex, display: true };
      },
    },
    {
      name: "inlineMath",
      level: "inline",
      start: chatMathStart,
      tokenizer(source) {
        const math = inlineChatMath(source);
        if (math) return { type: "inlineMath", raw: math.raw, text: math.tex, display: math.display };
      },
    },
    {
      name: "agentMention",
      level: "inline",
      start: (source) => source.indexOf("@["),
      tokenizer(source) {
        const reference = chatTagReferences(source)[0];
        if (reference?.start === 0 && reference.kind === "agent")
          return { type: "agentMention", raw: source.slice(0, reference.end) };
      },
    },
  ],
});

export function parseChatMarkdown(body: string) {
  return markdown.lexer(body);
}

const MAX_CACHED_BODIES = 300;
const parsedBodies = new Map<string, ReturnType<typeof parseChatMarkdown>>();

/**
 * The tokens of a finished message, parsed once for the app run rather than each time its chat
 * opens. The renderers only read the tokens. A streaming reply changes on each chunk, so it uses
 * `parseChatMarkdown` and does not fill the cache.
 */
export function parseFinishedChatMarkdown(body: string) {
  const cached = parsedBodies.get(body);
  if (cached) {
    parsedBodies.delete(body);
    parsedBodies.set(body, cached);
    return cached;
  }
  const tokens = parseChatMarkdown(body);
  const oldest = parsedBodies.keys().next().value;
  if (parsedBodies.size >= MAX_CACHED_BODIES && oldest !== undefined) parsedBodies.delete(oldest);
  parsedBodies.set(body, tokens);
  return tokens;
}
