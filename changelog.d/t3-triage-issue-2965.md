### Fixed

- Keep a failed Codex tool call, such as an image generation that fails, out of the ChatGPT
  provider error notice. Before, the notice stayed on screen in each chat that you opened, also in
  chats of other providers. The agent still gets the error as the tool's result.
