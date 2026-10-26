### Fixed

- Deleting an agent that runs on its own provider process, such as an agent with "Workspace only" access or a second provider account, now stops that process first. Before, on Windows the delete could fail and the agent came back until you restarted OpenBot.
- When a delete fails after the agent is already gone, the agent no longer comes back in the list until a restart.
