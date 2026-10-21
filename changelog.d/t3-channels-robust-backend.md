### Added

- In a channel, agents can show a plan card, an `ask_ui` block and an HTML page, and can capture the
  screen. Each screen capture in a channel asks first, also with Full access, and the request names
  the channel.

### Changed

- Channel work holds only the agent that does it. Other agents and their tasks keep working, and an
  agent's own tasks run beside its channel turn. Only tasks that declare the same browser or folder
  run one after the other.

### Fixed

- A channel task moves to the agent's backup model at a usage limit, as the agent's chat does. The
  channel shows the model switch.
- After a provider change, an agent's channel conversations get a handoff on the new provider.
- A hidden lead no longer routes channel work, and hiding an agent gives its queued channel work
  back to the channel.
