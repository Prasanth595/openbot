### Fixed

- Keep message sends and queue status changes fast when the chat history is long. Before, each
  change wrote all mailbox messages again, so the app became slower as the history grew.
