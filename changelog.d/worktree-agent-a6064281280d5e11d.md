### Fixed

- A hosted server that wakes now handles the kept Slack, Discord and Telegram events of each workspace or chat separately. Before, one connection that could not start held back the events of all other connections, and each of its events waited 60 seconds.
