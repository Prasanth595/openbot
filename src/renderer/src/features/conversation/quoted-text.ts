import { findChatSearchMatches } from "./chat-search";

const QUOTE_HIGHLIGHT = "openbot-quote-target";

let releaseHighlight: AbortController | undefined;

/** The text blocks of a sent message. A message with a table or a card has more than one. */
export function messageTextBlocks(root: ParentNode, messageId: string): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(`.message-copy[data-selection-message-id="${CSS.escape(messageId)}"]`),
  );
}

/**
 * Marks the first place in the message where the quoted text shows, and returns it. The mark stays
 * until the next pointer press or Escape. Returns null when the message no longer has the text.
 */
export function highlightQuotedText(blocks: HTMLElement[], text: string): Range | null {
  clearQuotedTextHighlight();
  const row = blocks[0]?.closest<HTMLElement>("[data-chat-search-message]");
  if (!row?.parentElement) return null;
  const range =
    findChatSearchMatches(row.parentElement, text).find(
      (match) => match.message === row && blocks.some((block) => block.contains(match.range.startContainer)),
    )?.range ?? null;
  const registry = globalThis.CSS?.highlights;
  if (!range || !registry) return range;
  registry.set(QUOTE_HIGHLIGHT, new Highlight(range));
  releaseHighlight = new AbortController();
  const view = row.ownerDocument.defaultView;
  view?.addEventListener("pointerdown", clearQuotedTextHighlight, { signal: releaseHighlight.signal });
  view?.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") clearQuotedTextHighlight();
    },
    { signal: releaseHighlight.signal },
  );
  return range;
}

export function clearQuotedTextHighlight(): void {
  releaseHighlight?.abort();
  releaseHighlight = undefined;
  globalThis.CSS?.highlights?.delete(QUOTE_HIGHLIGHT);
}
