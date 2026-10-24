### Changed

- Claude agents that use an Anthropic API key now keep the prompt cache for 1 hour. Before, the
  cache stayed for 5 minutes, so a turn that started later sent the full context again at the full
  price. A `promptCacheTtl` in the Claude settings, or `CLAUDE_CODE_PROMPT_CACHE_TTL`, still sets
  the time.
