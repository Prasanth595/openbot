# Chat opening and Live Activities

The chat cache holds the latest complete host page, separate from expanded history and search windows.
It retains up to five inactive chats for ten minutes, with a combined 10 MiB serialized payload limit.
Observed chats are outside eviction. Account, host, and agent form the scope. Sign-out, host removal,
and agent access loss clear the matching data. Nothing is written to a chat database on the phone.

A Team press prefetches one page. An open chat reuses a pending read. A retained page renders before
its own background revalidation starts. Search loads its target immediately. Reconnect refreshes observed
chats before inactive chats. Live Activity and notification taps use native navigation without a Team
layout or avatar source; Team taps retain their zoom transition. An already-open target is retained.

## Local timing

`chat-open-performance.ts` retains up to 40 samples with local stage durations only. It sends no event,
identifier, URL, message, or file content. Stages record connection, fetch, data, projection, navigation,
message layout and composer layout. Two animation frames after layout are a visibility proxy; they do
not replace a native render trace. Low-priority foreground work waits for this frame. A two-second
deadline prevents an unavailable host from blocking that work indefinitely. Background Live Activity
registration does not wait for animation frames.

The native development inspector can read these durations. Production exposes no inspector hook.

## Focused verification

Use the existing Metro instance and development client:

```sh
bun scripts/mobile-chat-cache-e2e.ts <simulator-uuid> <metro-port>
bun scripts/mobile-chat-navigation-e2e.ts <simulator-uuid> <metro-port> --repeat
bun scripts/mobile-activity-e2e.ts <simulator-uuid> <metro-port>
bun scripts/live-activity-lifecycle-e2e.ts
bun scripts/live-activity-server-mute-e2e.ts
```

The cache preview uses synthetic messages in the real app cache service. Navigation uses an accessible
agent in the running app and can mark that chat read. It sends no message. The repeat check performs
20 warm external opens and 10 background returns. Its artifact explicitly identifies development mode
and does not claim a speed improvement. Reports are under `.openbot-build/`.

For performance conclusions, record a baseline and the result on the same release/profileable device,
host, network and data. Include Team presses, external taps, cold launches, short and long chats,
Markdown, attachments, search and a disconnected host. Measure 20 warm opens and 10 cold/background
returns. Check pagination, scroll position, duplicate requests and account separation.

Check Live Activity light/dark appearance, large text, Always-On, stale content, rapid events,
repeated taps, token rotation, disabled frequent updates and host switching on a physical iPhone.
The simulator checks do not establish real APNs delivery, device power behavior or push throttling.
