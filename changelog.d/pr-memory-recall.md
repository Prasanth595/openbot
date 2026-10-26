### Added

- Agents now get the saved memories that fit each message you send, without a memory search. This
  works with no extra model call, and not in channels or Slack, Discord and Telegram chats.
- Before an agent starts a new provider session, its model reads the end of the old one and saves
  lasting facts as searchable memories. Turn this off in Settings › Memory.
- Memory search finds Chinese and Japanese memories by part of a phrase.
