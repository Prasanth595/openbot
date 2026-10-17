import { createFileRoute } from "@tanstack/solid-router";
import { MessagingConnectPage } from "../../components/transactional/MessagingConnectPage";

export const Route = createFileRoute("/slack/connect")({
  head: () => ({
    meta: [
      { title: "Return to OpenBot" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  headers: () => ({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  }),
  component: SlackConnect,
});

function SlackConnect() {
  return <MessagingConnectPage provider="slack" />;
}
