### Added

- Server settings › General › Agents has a "Claude prompt cache" setting: 1 hour or 5 minutes.
  An owner or admin can set it for this computer and for a joined server.

### Changed

- Claude agents now keep the prompt cache for 1 hour by default, also with an Anthropic API key.
  Before, with an API key the cache stayed for 5 minutes, so a turn that started later sent the
  full context again at the full price. A `promptCacheTtl` in the Claude settings, or
  `CLAUDE_CODE_PROMPT_CACHE_TTL`, still sets the time.
