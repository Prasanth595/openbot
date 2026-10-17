import type { AgentMessage } from "@openbot/ui/data";
import { preferredMessageScrollBehavior } from "@openbot/ui/features/conversation/MessageNavigation";
import type { VirtualItem } from "@tanstack/virtual-core";
import { createEffect, createMemo, createSignal } from "solid-js";
import type { ConversationProps } from "../conversation-types";

/* The frames a row gets to appear after a scroll to its index or a page load. */
const ROW_WAIT_FRAMES = 30;
/* A row this far inside the edge of the view counts as seen. */
const ROW_SEEN_INSET_PX = 40;
/* The frames with no scroll change after which a smooth scroll counts as stopped. */
const SCROLL_IDLE_FRAMES = 6;
/* A scroll that another scroll stopped before its goal gets one more try. */
const SCROLL_ATTEMPTS = 2;
const FLASH_ANIMATION = "reply-flash";

export interface ReplyJumpStoreDeps {
  props: ConversationProps;
  scrollElement: () => HTMLDivElement | undefined;
  timelineIndexById: () => ReadonlyMap<VirtualItem["key"], number>;
  scrollToIndex: (index: number) => void;
  setStickToLatest: (value: boolean) => void;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * The quote of a reply opens its original: the chat scrolls to it and flashes it, and a pill leads
 * back to the reply. An original that is not loaded is loaded first, with the page around it.
 */
export function createReplyJumpStore(deps: ReplyJumpStoreDeps) {
  const [returnReplyId, setReturnReplyId] = createSignal<string | null>(null);
  const [loadingReplyId, setLoadingReplyId] = createSignal<string | null>(null);
  const [unavailableReplyId, setUnavailableReplyId] = createSignal<string | null>(null);
  const messageIds = createMemo(() => new Set(deps.props.messages.map((message) => message.id)));
  let jumping = false;

  createEffect(
    () => deps.props.agent?.id,
    () => {
      setReturnReplyId(null);
      setLoadingReplyId(null);
      setUnavailableReplyId(null);
    },
  );

  function messageElement(id: string): HTMLElement | undefined {
    // A message in a group of agent messages has no row of its own, so the group row is the target.
    const escaped = CSS.escape(id);
    return (
      deps
        .scrollElement()
        ?.querySelector<HTMLElement>(
          `[data-chat-search-message="${escaped}"], [data-chat-search-group~="${escaped}"]`,
        ) ?? undefined
    );
  }

  const rowElement = (id: string) => messageElement(id)?.closest<HTMLElement>(".virtual-chat-row") ?? undefined;

  /* The drawn row of a loaded message. A virtualized row that is far away is drawn first. */
  async function findRow(id: string): Promise<HTMLElement | undefined> {
    const drawn = rowElement(id);
    if (drawn) return drawn;
    const index = deps.timelineIndexById().get(id);
    if (index === undefined) return undefined;
    deps.scrollToIndex(index);
    for (let frame = 0; frame < ROW_WAIT_FRAMES; frame += 1) {
      await nextFrame();
      const row = rowElement(id);
      if (row) return row;
    }
    return undefined;
  }

  /**
   * Ends at the goal, when the reader takes the scroll over, or when the scroll stops before its
   * goal. Another scroll, such as the follow of a page that loads, can stop this one.
   */
  function scrollToCentre(element: HTMLElement, row: HTMLElement): Promise<"goal" | "input" | "stopped"> {
    const top =
      row.getBoundingClientRect().top -
      element.getBoundingClientRect().top +
      element.scrollTop -
      (element.clientHeight - row.offsetHeight) / 2;
    const goal = Math.round(Math.min(Math.max(0, top), element.scrollHeight - element.clientHeight));
    const behavior = preferredMessageScrollBehavior();
    if (behavior !== "smooth" || Math.abs(element.scrollTop - goal) <= 1) {
      element.scrollTo({ top: goal });
      return Promise.resolve("goal");
    }
    return new Promise((resolve) => {
      const inputs = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
      let done = false;
      const finish = (result: "goal" | "input" | "stopped") => {
        if (done) return;
        done = true;
        for (const input of inputs) element.removeEventListener(input, onInput);
        resolve(result);
      };
      const onInput = () => finish("input");
      for (const input of inputs) element.addEventListener(input, onInput, { passive: true });
      element.scrollTo({ top: goal, behavior });
      let lastTop = element.scrollTop;
      let idleFrames = 0;
      const watch = () => {
        if (done) return;
        const current = element.scrollTop;
        if (Math.abs(current - goal) <= 1) return finish("goal");
        idleFrames = current === lastTop ? idleFrames + 1 : 0;
        lastTop = current;
        if (idleFrames >= SCROLL_IDLE_FRAMES) return finish("stopped");
        requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    });
  }

  /* Scrolls the message to the middle of the view. `undefined` when the chat no longer has it. */
  async function reveal(id: string, replyId: string): Promise<HTMLElement | undefined> {
    deps.setStickToLatest(false);
    let row = await findRow(id);
    if (!row && deps.props.onOpenSearchMessage) {
      setLoadingReplyId(replyId);
      try {
        await deps.props.onOpenSearchMessage(id);
        await nextFrame();
        row = await findRow(id);
      } finally {
        setLoadingReplyId(null);
      }
    }
    const element = deps.scrollElement();
    if (!row || !element) return undefined;
    for (let attempt = 0; attempt < SCROLL_ATTEMPTS; attempt += 1) {
      // A scroll event near the bottom can set the follow of the latest message again.
      deps.setStickToLatest(false);
      if ((await scrollToCentre(element, row)) !== "stopped") break;
      row = await findRow(id);
      if (!row) return undefined;
    }
    return row;
  }

  function flash(row: HTMLElement): void {
    delete row.dataset.replyFlash;
    // A new flash on a row that still flashes starts again from the start.
    void row.offsetWidth;
    row.dataset.replyFlash = "";
    const end = (event: AnimationEvent) => {
      if (event.target !== row || event.animationName !== FLASH_ANIMATION) return;
      row.removeEventListener("animationend", end);
      delete row.dataset.replyFlash;
    };
    row.addEventListener("animationend", end);
  }

  /* The way back removes the control that had focus, so focus goes to the quote of the reply. */
  function focusQuote(replyId: string): void {
    messageElement(replyId)?.querySelector<HTMLElement>(".message-reply-open")?.focus({ preventScroll: true });
  }

  async function openReference(reply: AgentMessage): Promise<void> {
    const targetId = reply.replyToMessageId;
    if (!targetId || jumping) return;
    jumping = true;
    setUnavailableReplyId(null);
    try {
      const row = await reveal(targetId, reply.id);
      if (!row) {
        setUnavailableReplyId(reply.id);
        return;
      }
      flash(row);
      setReturnReplyId(reply.id);
      // A page load removes the quote that had focus. Focus then goes to the way back.
      if (!document.activeElement || document.activeElement === document.body) {
        await nextFrame();
        deps.scrollElement()?.querySelector<HTMLElement>("[data-reply-return] .scroll-to-latest-button")?.focus();
      }
    } finally {
      jumping = false;
    }
  }

  async function returnToReply(): Promise<void> {
    const replyId = returnReplyId();
    if (!replyId || jumping) return;
    jumping = true;
    setReturnReplyId(null);
    try {
      const row = await reveal(replyId, replyId);
      if (!row) return;
      flash(row);
      focusQuote(replyId);
    } finally {
      jumping = false;
    }
  }

  function stayHere(): void {
    const replyId = returnReplyId();
    setReturnReplyId(null);
    if (replyId) focusQuote(replyId);
  }

  /* The pill goes when the reader scrolls back to the reply on their own. */
  function updateReturnVisibility(): void {
    const replyId = returnReplyId();
    const element = deps.scrollElement();
    if (!replyId || jumping || !element) return;
    const row = rowElement(replyId);
    if (!row) return;
    const bounds = element.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();
    if (rowBounds.bottom > bounds.top + ROW_SEEN_INSET_PX && rowBounds.top < bounds.bottom - ROW_SEEN_INSET_PX) {
      setReturnReplyId(null);
    }
  }

  /**
   * The state of a reply's quote. A reply whose original is neither loaded nor among the
   * references the host sent quotes a deleted message. A host that sends no references cannot
   * tell, so its quote stays as it is.
   */
  function referenceState(reply: AgentMessage | undefined, referenced: AgentMessage | undefined) {
    if (!reply?.replyToMessageId) return undefined;
    if (loadingReplyId() === reply.id) return "loading";
    if (unavailableReplyId() === reply.id) return "unavailable";
    if (!referenced && deps.props.messageReferences && !messageIds().has(reply.replyToMessageId)) {
      return "unavailable";
    }
    return undefined;
  }

  return {
    returnReplyId,
    openReference,
    returnToReply,
    stayHere,
    updateReturnVisibility,
    referenceState,
  };
}
