### Changed

- Agents no longer get the OAuth token of an MCP server that you signed in to. They reach the server through a local address in OpenBot, which adds the token to each call.

### Fixed

- An MCP token that expires during a long agent session is now renewed. Before, the agent kept the old token until its session restarted.
- After you sign out of an MCP server, or the server ends the sign-in, an agent that calls one of its tools now gets a message that tells it to sign in again in OpenBot.
