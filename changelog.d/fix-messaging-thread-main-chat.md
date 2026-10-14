### Fixed

- An agent that answers in Discord, Slack or Telegram no longer stops answering after a restart. Before, a restart could make one of its conversations the agent's own chat. Then, after a routine ran there, every new message waited with "OpenBot is working on another request" until OpenBot restarted. A restart no longer does this. An agent that is already in this state keeps its chat and its history, and answers again.
- The chat of such an agent shows its new messages in the app again.
