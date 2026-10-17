/**
 * What a tag in a message names. `mcp` is one of the host's MCP servers: a tag is a hint for the
 * model, in the same way a skill tag is, and it changes no tool the provider is given. `quote` is
 * text the user selected in a message of the same chat: its name is that text and its id is the
 * message id.
 *
 * An app that predates a kind does not match its marker, so it shows the marker text rather than
 * the name. Message bodies are stored as written, so an older app reading a newer message is a
 * real case, and it stays readable.
 */
export type ChatTagKind = "agent" | "skill" | "mcp" | "quote";

export interface ChatTagReference {
  kind: ChatTagKind;
  id: string;
  name: string;
  start: number;
  end: number;
}

const CHAT_TAG_REFERENCE_PATTERN = /@\[([^\]\r\n]+)\]\((agent|skill|mcp|quote)(\+uri)?:([^)\r\n]+)\)/gu;

/*
 * Quoted text is any text, and Markdown reads the marker as a link. A bracket, a backslash, a
 * backtick or an angle bracket in it could end the link early or open a span past its end.
 */
const UNSAFE_QUOTE_NAME = /[[\]\\`<\r\n]/u;

export function serializeChatTagReference(kind: ChatTagKind, name: string, id: string): string {
  const unsafeName = kind === "quote" ? UNSAFE_QUOTE_NAME : /[\]\r\n]/u;
  if (name && id && !unsafeName.test(name) && !/[)\r\n]/u.test(id)) return `@[${name}](${kind}:${id})`;
  return `@[${encodeChatTagComponent(name)}](${kind}+uri:${encodeChatTagComponent(id)})`;
}

export function chatTagReferences(value: string): ChatTagReference[] {
  return [...value.matchAll(CHAT_TAG_REFERENCE_PATTERN)].map((match) => ({
    kind: chatTagKind(match[2]),
    id: decodeChatTagComponent(match[4] ?? "", match[3] !== undefined),
    name: decodeChatTagComponent(match[1] ?? "", match[3] !== undefined),
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function chatTagKind(value: string | undefined): ChatTagKind {
  if (value === "skill" || value === "mcp" || value === "quote") return value;
  return "agent";
}

export function expandChatTagReferences(
  value: string,
  resolveName?: (reference: ChatTagReference) => string | undefined,
): string {
  return value.replace(
    CHAT_TAG_REFERENCE_PATTERN,
    (
      marker,
      encodedName: string,
      kind: ChatTagKind,
      encoding: string | undefined,
      encodedId: string,
      offset: number,
    ) => {
      const name = decodeChatTagComponent(encodedName, encoding !== undefined);
      const id = decodeChatTagComponent(encodedId, encoding !== undefined);
      const reference = { kind, id, name, start: offset, end: offset + marker.length };
      if (kind === "quote") return expandedQuote(name, value, offset, offset + marker.length);
      const resolvedName = resolveName?.(reference) ?? name;
      return expandedChatTag(kind, resolvedName);
    },
  );
}

const QUOTE_AT_END = /@\[[^\]\r\n]+\]\(quote(?:\+uri)?:[^)\r\n]+\)[^\S\r\n]*$/u;

/**
 * A quote is a Markdown block quote on its own lines, so the provider reads it as quoted text and
 * the words after it as the user's answer to it.
 */
function expandedQuote(text: string, value: string, start: number, end: number): string {
  const quote = text
    .split(/\r?\n/u)
    .map((line) => (line.trim() ? `> ${line}` : ">"))
    .join("\n");
  const before = value.slice(0, start);
  const after = value.slice(end);
  // A quote just before this one already ends with a blank line.
  const separated = !before.trim() || before.endsWith("\n\n") || QUOTE_AT_END.test(before);
  const prefix = separated ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const suffix = !after.trim() ? "" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  return `${prefix}${quote}${suffix}`;
}

/** What the provider reads in place of a marker. A name alone would not say what it names. */
function expandedChatTag(kind: Exclude<ChatTagKind, "quote">, name: string): string {
  if (kind === "agent") return `@${name}`;
  return kind === "mcp" ? `${name} (MCP server)` : `${name} (skill)`;
}

function encodeChatTagComponent(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function decodeChatTagComponent(value: string, encoded: boolean): string {
  if (!encoded) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
