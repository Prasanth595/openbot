### Fixed

- Keep queue updates fast when an agent has received many messages. Before, each queue change
  searched all mailbox messages once for each message of the agent, so the app became slower as the
  history grew.
