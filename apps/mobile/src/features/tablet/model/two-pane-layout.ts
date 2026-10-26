/**
 * The width from which the chat list stays beside the chat. An iPad in portrait is 744 pt or more,
 * so a full-screen window always reaches it, and the narrow windows of Slide Over and Split View
 * keep the phone layout, where the list and the chat take the window in turn.
 */
export const TWO_PANE_MIN_WIDTH = 744;
const SIDEBAR_MIN_WIDTH = 300;
const SIDEBAR_MAX_WIDTH = 380;
/** The part of the window the list takes, between its two bounds, as the desktop sidebar does. */
const SIDEBAR_WIDTH_RATIO = 0.32;

/** Whether a window of this width on this device holds the chat list beside the chat. */
export function showsTwoPane(windowWidth: number, tablet: boolean): boolean {
  return tablet && windowWidth >= TWO_PANE_MIN_WIDTH;
}

/** The width of the chat list beside the chat, for a window of this width. */
export function sidebarWidth(windowWidth: number): number {
  return Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, windowWidth * SIDEBAR_WIDTH_RATIO)));
}
