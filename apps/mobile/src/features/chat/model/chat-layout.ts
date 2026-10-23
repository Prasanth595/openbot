/** The left screen edge belongs to Back, not swipe-to-reply. */
export const CHAT_BACK_EDGE_WIDTH = 24;

/** Whether the end of the content shows above the composer and the keyboard. */
export function chatContentIsVisible(content: number, viewport: number, scrollY: number, obstruction: number): boolean {
  "worklet";
  // Blank space is not unread content. Only the keyboard and composer obscure messages.
  return content <= scrollY + viewport - obstruction + 2;
}
