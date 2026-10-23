### Fixed

- GPT-6 models in ChatGPT (Codex CLI) now call the tools of your MCP servers, such as Composio.
  Before, the server test found the tools, but the model did not see them and asked for another
  message. Existing conversations get the fix on their next message and keep their history.
