### Fixed

- Stop showing `thread not loaded` in a Codex chat at each start. OpenBot now reads the history of an
  agent on a second Codex account through that account, and ignores a session that Codex has no saved
  history for.
- Start a new Codex session when Codex has no saved history for the old one. Before, each message to
  that chat failed.
