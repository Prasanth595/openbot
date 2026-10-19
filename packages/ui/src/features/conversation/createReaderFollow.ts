/** A keyboard or wheel scroll moves the chat within a few frames of its input. */
const READER_INPUT_WINDOW_MS = 250;
/** Within this distance of the end, a reader who did not scroll away still reads the latest message. */
const LATEST_DISTANCE = 80;

export interface ReaderFollow {
  /** Whether the chat follows new content to the end. */
  following: () => boolean;
  /** Follows the latest message again, by request or because the reader came back. Ends the reader's hold. */
  follow: () => void;
  /** Stops the follow for a jump to an older message. The reader's next move down to the end follows again. */
  stop: () => void;
  /** Call from the chat's scroll event. */
  scrolled: (element: HTMLElement) => void;
  /** Watches the reader's input on the chat and its document. Returns the cleanup. */
  listen: (scrollElement: HTMLElement) => () => void;
}

/**
 * Whether a chat follows new content, decided by the reader. The reader moved up, so the chat stops
 * following until the reader moves down again or asks for the latest message. While replies arrive,
 * the content grows many times a second and each growth moves a following chat back to the bottom;
 * a scroll of less than 80px still counts as the bottom, and a scroll event that the chat's own follow
 * queued can arrive after the reader's input. So the reader decides, not the distance.
 *
 * A scroll is the reader's when the chat moves the way that the reader's last input asked, soon after
 * it, or while the reader drags the scroll bar or a text selection. Input that moves something else,
 * such as a code block that scrolls, a sideways swipe or a key in a field, does not move the chat.
 *
 * `onLeave` runs when the reader leaves the latest message, so the chat can cancel a follow it queued.
 */
export function createReaderFollow(onLeave?: () => void): ReaderFollow {
  let following = true;
  let readerLeftLatest = false;
  let lastScrollTop = 0;
  let readerDragging = false;
  let readerIntent: { up: boolean; at: number } | undefined;
  let lastTouchY: number | undefined;

  function leaveLatest(): void {
    readerLeftLatest = true;
    following = false;
    onLeave?.();
  }
  function noteReaderIntent(up: boolean): void {
    readerIntent = { up, at: performance.now() };
  }
  function readerWheel(event: WheelEvent): void {
    // Ctrl with the wheel zooms, and a sideways swipe can report a small vertical delta.
    if (event.ctrlKey || event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    noteReaderIntent(event.deltaY < 0);
  }
  function readerKeyDown(event: KeyboardEvent): void {
    if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home") noteReaderIntent(true);
    else if (event.key === "ArrowDown" || event.key === "PageDown" || event.key === "End") noteReaderIntent(false);
    else if (event.key === " ") noteReaderIntent(event.shiftKey);
  }
  function readerTouchMove(event: TouchEvent): void {
    const y = event.touches.length === 1 ? event.touches[0]?.clientY : undefined;
    // A finger that moves down scrolls the chat up.
    if (y !== undefined && lastTouchY !== undefined && y !== lastTouchY) noteReaderIntent(y > lastTouchY);
    lastTouchY = y;
  }
  function readerTouchEnd(): void {
    lastTouchY = undefined;
  }
  /* Only the main button drags. A context menu can take the release of another button. */
  function readerPointerDown(event: PointerEvent): void {
    if (event.button === 0) readerDragging = true;
  }
  function endReaderDrag(): void {
    readerDragging = false;
  }

  return {
    following: () => following,
    follow: () => {
      following = true;
      readerLeftLatest = false;
    },
    stop: () => {
      following = false;
    },
    scrolled: (element) => {
      const moved = element.scrollTop - lastScrollTop;
      lastScrollTop = element.scrollTop;
      const intent = readerIntent && performance.now() - readerIntent.at < READER_INPUT_WINDOW_MS ? readerIntent : null;
      if (moved < 0 && (readerDragging || intent?.up === true)) leaveLatest();
      else if (moved > 0 && (readerDragging || intent?.up === false)) readerLeftLatest = false;
      if (element.scrollHeight - element.scrollTop - element.clientHeight > LATEST_DISTANCE) following = false;
      else if (!readerLeftLatest) following = true;
    },
    listen: (scrollElement) => {
      const keyboardTarget = scrollElement.ownerDocument;
      const keyboardWindow = keyboardTarget.defaultView ?? window;
      scrollElement.addEventListener("wheel", readerWheel, { passive: true });
      scrollElement.addEventListener("touchmove", readerTouchMove, { passive: true });
      scrollElement.addEventListener("touchend", readerTouchEnd);
      scrollElement.addEventListener("touchcancel", readerTouchEnd);
      scrollElement.addEventListener("pointerdown", readerPointerDown);
      keyboardTarget.addEventListener("keydown", readerKeyDown);
      keyboardWindow.addEventListener("pointerup", endReaderDrag);
      keyboardWindow.addEventListener("pointercancel", endReaderDrag);
      return () => {
        scrollElement.removeEventListener("wheel", readerWheel);
        scrollElement.removeEventListener("touchmove", readerTouchMove);
        scrollElement.removeEventListener("touchend", readerTouchEnd);
        scrollElement.removeEventListener("touchcancel", readerTouchEnd);
        scrollElement.removeEventListener("pointerdown", readerPointerDown);
        keyboardTarget.removeEventListener("keydown", readerKeyDown);
        keyboardWindow.removeEventListener("pointerup", endReaderDrag);
        keyboardWindow.removeEventListener("pointercancel", endReaderDrag);
      };
    },
  };
}
