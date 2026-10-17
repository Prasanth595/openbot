### Fixed

- An MCP server that refuses a saved sign-in now shows "Sign-in needed" with a Sign in button. Before, its row looked signed in until a test failed.
- A background token renewal no longer registers a new OAuth client with the MCP server.
- Agents no longer get an MCP token that the server has already refused.

### Changed

- Signing out of an MCP server, or removing it, now asks the server's authorization service to revoke the tokens.
