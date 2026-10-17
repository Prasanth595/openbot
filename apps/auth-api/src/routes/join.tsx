import { createFileRoute } from "@tanstack/solid-router";
import { JoinPage } from "../components/landing/JoinPage";
import { OPENBOT_SOCIAL_IMAGE_ALT, OPENBOT_SOCIAL_IMAGE_URL, OPENBOT_X_HANDLE } from "../lib/site-metadata";

const JOIN_TITLE = "Join an OpenBot server";
const JOIN_DESCRIPTION = "Open a private server invitation in OpenBot.";

export const Route = createFileRoute("/join")({
  head: ({ match }) => {
    // Only the path: the query holds the invitation token, and a link preview must not copy it.
    const url = new URL("/join", match.context.siteUrl).toString();
    return {
      meta: [
        { title: JOIN_TITLE },
        { name: "robots", content: "noindex, nofollow, noarchive" },
        { name: "referrer", content: "no-referrer" },
        { name: "description", content: JOIN_DESCRIPTION },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "OpenBot" },
        { property: "og:locale", content: "en_US" },
        { property: "og:url", content: url },
        { property: "og:title", content: JOIN_TITLE },
        { property: "og:description", content: JOIN_DESCRIPTION },
        { property: "og:image", content: OPENBOT_SOCIAL_IMAGE_URL },
        { property: "og:image:alt", content: OPENBOT_SOCIAL_IMAGE_ALT },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:site", content: OPENBOT_X_HANDLE },
        { name: "twitter:title", content: JOIN_TITLE },
        { name: "twitter:description", content: JOIN_DESCRIPTION },
        { name: "twitter:image", content: OPENBOT_SOCIAL_IMAGE_URL },
        { name: "twitter:image:alt", content: OPENBOT_SOCIAL_IMAGE_ALT },
      ],
    };
  },
  headers: () => ({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  }),
  component: JoinPage,
});
