### Added

- When an agent's backup models are set to Automatic, a provider error now moves the agent to the next backup model too. This covers a spent balance, an unavailable provider, a rate limit, a sign-in error and a network error. The message runs again on the backup when the agent had not started to write, and the agent goes back to its own model after 10 minutes. Before, only a usage limit moved the agent.
- Agents can read and set the ordered backup models of an agent with `read_agent` and `update_profile`. `read_agent` also shows the model that the agent goes back to while it runs on a backup.
