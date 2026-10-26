import { router } from "expo-router";

/**
 * Leaves the chat that the detail pane shows, so the next one takes its place instead of stacking
 * on it. The list stays on screen beside the chat, so a chat opened from it is a new selection and
 * not a step deeper. The anchor of the stack is the empty detail pane, so there is always a screen
 * to return to.
 */
export function collapseDetailPane(): void {
  if (router.canDismiss()) router.dismissAll();
}
