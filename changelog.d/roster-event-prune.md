### Fixed

- Stop the database growth from agent list writes. Before, each message and each turn end added a
  full copy of the agent list to `openbot.db`, and the old copies stayed. The first write after the
  update removes them. Model changes that one agent made to another agent stay recorded.
