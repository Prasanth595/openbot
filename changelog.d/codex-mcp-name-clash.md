### Fixed

- A Codex chat now starts when `~/.codex/config.toml` has an MCP server with the same name as an
  OpenBot MCP server of the other type, such as a local `github` server and the GitHub connection.
  Before, Codex showed "url is not supported for stdio" and did not load its configuration. The
  OpenBot server now goes to Codex as `openbot_<name>`, and your own server stays as you wrote it.
