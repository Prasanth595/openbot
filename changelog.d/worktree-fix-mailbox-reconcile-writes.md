### Fixed

- Stop the database from growing each time a conversation is read. Before, each read wrote the
  latest messages again when nothing had changed, so `openbot.db` could grow by gigabytes. An
  upgrade deletes the repeated writes that follow each other in a chat, which are most of them,
  and makes the file smaller. On a large database, the first start after the upgrade takes longer.
