### Fixed

- A message that you steer into a running DeepSeek or Pi agent now goes into the running turn also while Pi compacts its context. When Pi refuses a steer, only the steer fails: the agent keeps working, and the message waits in the queue. Before, the refusal stopped the turn in the chat while Pi kept working, and the next messages failed with "Agent is already processing".
- A "Could not steer the agent" error no longer stays below the last reply after the turn ends. Before, it stayed at the end of the chat until you sent the next message, so it looked like a new message.
