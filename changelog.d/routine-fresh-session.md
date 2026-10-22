### Changed

- A routine run in an agent's own chat now starts its own provider session, so it uses fewer
  tokens. Before, each run sent the whole chat context again. The run reads the newest chat
  messages, and its answer still shows in the chat. The agent reads the answer with its next
  message. A task, channel or messaging routine runs as before.
