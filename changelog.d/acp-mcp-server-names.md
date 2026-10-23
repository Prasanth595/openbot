### Fixed

- An MCP server with a space or another special character in its name no longer stops Gemini and other ACP agents. Before, each task failed with `invalid params`. OpenBot now changes these characters to `_` when it gives the server to the agent.
