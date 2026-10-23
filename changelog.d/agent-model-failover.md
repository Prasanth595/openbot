### Added

- When an agent's backup models are set to Automatic, a provider error now moves the agent to the next backup model too. This covers a spent balance, an unavailable provider, a rate limit, a sign-in error and a network error. The message runs again on the backup when the agent had not started to write, and the agent goes back to its own model after 10 minutes. Before, only a usage limit moved the agent.
- `read_agent` now says when a provider error, not a usage limit, keeps an agent on a backup model.
