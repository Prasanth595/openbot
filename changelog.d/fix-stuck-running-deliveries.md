### Fixed

- A message no longer stays "running" after its turn ended with an error. Before, a failure at the end of a turn or during the recovery after a restart could keep the message running, and the agent's next messages waited in the queue. Stop did not clear it. Now the message ends as interrupted or failed, the next message starts, and Stop clears a message that no provider runs.
