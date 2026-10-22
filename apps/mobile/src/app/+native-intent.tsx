import { acceptDevelopmentConnectLink } from "@/features/auth/model/development-connect-link";
import { redirectIncomingLink } from "@/features/links/model/incoming-links";
import { isLiveActivityLink, liveActivityRoute } from "@/features/live-activity/model/live-activity-link";
import { isMessagingInstallReturn } from "@/features/servers/model/connectors";
import { isIncomingShareLink } from "@/features/share/model/share-link";

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  if (__DEV__) {
    try {
      const url = new URL(path);
      // The development client also sends its launcher URL to Expo Router. It opens
      // the bundle, not app content; keep warm launches on the current screen.
      if (
        url.protocol === "exp+openbot:" &&
        url.host === "expo-development-client" &&
        url.username === "" &&
        url.password === "" &&
        (url.pathname === "" || url.pathname === "/")
      )
        return initial ? "/" : null;
      if (url.protocol === "openbot:" && url.hostname === "motion-preview" && !url.pathname) {
        const phase = url.searchParams.get("phase");
        const query = new URLSearchParams();
        if (phase && ["idle", "thinking", "generating", "tool", "done"].includes(phase)) query.set("phase", phase);
        if (url.searchParams.get("still") === "1") query.set("still", "1");
        if (url.searchParams.get("cache") === "1") query.set("cache", "1");
        if (url.searchParams.get("reply") === "1") query.set("reply", "1");
        return `/motion-preview${query.size ? `?${query}` : ""}`;
      }
    } catch {
      /* Other incoming links keep their existing decoder. */
    }
  }
  // `bun run dev:mobile` pairs a simulator without a tap. DevelopmentConnectLinkHandler redeems it.
  if (acceptDevelopmentConnectLink(path, __DEV__)) return null;
  // The browser session of Server settings › Connectors takes the return of a Slack or Discord install.
  // The same link from another place has no install to finish, so it opens nothing.
  if (isMessagingInstallReturn(path)) return null;
  try {
    if (isLiveActivityLink(path)) return liveActivityRoute(path, initial);
    if (isIncomingShareLink(path)) return "/incoming-share";
    return redirectIncomingLink(path);
  } catch {
    return "/incoming-link";
  }
}
