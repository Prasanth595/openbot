### Fixed

- The Composio listing now connects with a Composio Connect link (`https://connect.composio.dev/mcp`) and its API key. Before, the key went in a header that Composio Connect does not read, and the connection failed with "This server asks for a sign-in".
- A server that refuses a pasted key now says to check the key. Before, it said to sign in.
