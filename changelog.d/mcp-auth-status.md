### Fixed

- Let Codex models that use Code Mode only, including GPT-6-Luna, call enabled MCP apps.
  Before, Composio could list its tools but the agent could not call them. Existing conversations
  receive the corrected configuration without losing their identity or history.
- Separate local OAuth state from MCP discovery results, and direct agents to external MCP tools
  without asking for repeated retries. A successful server test no longer implies app access.
- Show saved Marketplace plugins as Installed instead of Connected, so installation does not
  imply a verified connection to an app account.
