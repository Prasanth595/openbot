### Fixed

- Let a Claude agent answer again after you switch it to OpenCode and back. Before, each message
  failed with "--resume requires a valid session ID", also after a restart. An agent that has this
  fault now starts a new Claude session and keeps its conversation.
