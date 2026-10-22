### Changed

- Use native tabs for Team, Tasks, Routines, Market and Settings. Keep tab state and host-specific task drafts when switching pages.
- Add a lead-agent card, protected lead pin, read/unread actions and consistent agent artwork across Team, chat and profiles. Keep channels and their shared pin limit.
- Update search, chat, agent profiles and Brain settings. Show collaboration events and synchronized satellite activity, and keep completed replies clear of stale activity rows.
- Add mobile Marketplace agent and skill installation, installed state and existing MCP setup. Reconcile temporary receipts with later complete host lists.
- Show provider plan limits and reset times in a collapsed sidebar summary, with details in Usage. Show the shortest limit first.
- Keep the latest page of five recent chats in memory for up to ten minutes, within a 10 MiB payload limit. Prefetch on agent press and open external chat links without waiting for Team layout.
- Publish important Live Activity transitions at once, serialize native updates and defer avatar preparation until after chat opens. Retry failed avatar preparation once without naming missing files.
- Respect member access in task, routine and Brain controls. Retain the host in routine chat links, preserve lead pin order after failed hides, and fix Android header clearance and iOS scroll touch areas.
