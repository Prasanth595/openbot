### Fixed

- An agent that answers in Slack, Discord or Telegram no longer stops answering after a provider error. Before, a failed Muse turn start, a provider that exited, a turn that ended before its start was confirmed, or a turn start with no confirmation could hold every later message with "OpenBot is working on another request" until OpenBot restarted.
- An agent in a Slack, Discord or Telegram conversation no longer waits for an answer to a question card that nobody there can see. It asks the question in its answer instead.
- An approval request that did not reach Slack, Discord or Telegram is posted again when the conversation is connected. Before, the turn waited with no notice in the conversation.
- The "Working" and "Waiting" posts in Slack, Discord and Telegram now end after a restart, a provider crash or a lost connection. Before, they stayed with a Stop button that did nothing, and an answer that could not be posted was lost.
- Slack and Discord messages no longer wait minutes to start when a channel or user name lookup is slow.
- A hosted server that wakes now handles the kept Slack, Discord and Telegram events of each workspace or chat separately. Before, one connection that could not start held back the events of all other connections, and each of its events waited 60 seconds.
- A Telegram chat that you link while OpenBot connects to Signal again now shows in OpenBot. Before, the link could be lost, and you had to link the chat again. This fix needs a Signal deployment.
