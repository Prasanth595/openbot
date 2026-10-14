### Added

- Backup models for a usage limit. When the plan of an agent's model refuses a turn, the chat shows a card: send the queued message to another connected model now, or wait for the reset. By default the agent asks first. Agent settings › Backup models keeps an order; turn off "Ask before switching" and the agent moves to the first ready model in the order without a question. A note in the chat shows each switch, and the agent goes back to its own model when the limit ends. The agent keeps its workspace and thread.
