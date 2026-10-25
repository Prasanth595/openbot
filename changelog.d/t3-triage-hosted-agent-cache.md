### Added

- Claude can use an Anthropic API key. Open the Claude page in Server settings → Providers and select Add key. A saved
  key is used instead of the Claude account, and Anthropic bills each request to the key. Remove the
  key to use the Claude plan again. A joined server shows the key when the server also has this
  version.

### Fixed

- A custom provider with a base URL on `api.anthropic.com` now uses Anthropic's Messages API, so
  OpenCode adds prompt cache breakpoints. Before, it used Anthropic's OpenAI-compatible endpoint, which
  does not cache, so each turn paid the full input price.
- Usage and cost for OpenCode turns now count the uncached input, the cache reads and writes, and the
  thinking tokens of each turn. Before, a turn could show no uncached input.
- Analytics now records why a provider download failed, for example no disk space or a failed
  checksum. Before, each failure was recorded as `unknown`.
