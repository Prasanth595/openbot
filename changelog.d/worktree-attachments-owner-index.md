### Fixed

- A chat update finds the attachments of each changed message from an index. Before, each changed
  message read every attachment in the database, so a large mailbox sync or a long chat slowed OpenBot.
