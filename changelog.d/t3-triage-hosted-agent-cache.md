### Added

- Claude can use an Anthropic API key. Open the Claude page in Server settings → Providers and select
  Add key. The key shows as an "API key" account. To bill an agent to the key, select the API key
  account in the agent's model menu. Other agents keep the Claude plan. When Claude has no sign-in,
  all agents use the key. A joined server shows the key when the server also has this version.

### Fixed

- A custom provider with a base URL on `api.anthropic.com` now uses Anthropic's Messages API, so
  OpenCode adds prompt cache breakpoints. Before, it used Anthropic's OpenAI-compatible endpoint, which
  does not cache, so each turn paid the full input price.
- Usage and cost for OpenCode turns now count the uncached input, the cache reads and writes, and the
  thinking tokens of each turn. Before, a turn could show no uncached input.
- Analytics now records why a provider download failed, for example no disk space or a failed
  checksum. Before, each failure was recorded as `unknown`.
- When you save or remove a provider API key, agents that a usage limit held now continue at once.
  Before, they waited for the old plan's limit to reset, which could take days.
