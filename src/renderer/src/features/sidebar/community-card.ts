import { createSignal } from "solid-js";

/** Dismissing the community card is a choice of this computer or browser, like the mobile app card. */
const COMMUNITY_CARD_DISMISSED_STORAGE_KEY = "openbot:community-card-dismissed";

/** Whether the sidebar shows the community card, for the desktop sidebar and the web client. */
export function createCommunityCardVisibility() {
  const [dismissed, setDismissed] = createSignal(
    window.localStorage.getItem(COMMUNITY_CARD_DISMISSED_STORAGE_KEY) === "true",
  );
  return {
    dismissed,
    dismiss: () => {
      window.localStorage.setItem(COMMUNITY_CARD_DISMISSED_STORAGE_KEY, "true");
      setDismissed(true);
    },
  };
}
