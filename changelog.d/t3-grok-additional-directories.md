### Fixed

- Grok agents answer again with Grok CLI 1.0.60. Before, every new Grok session failed with
  `Invalid params: additionalDirectories is not supported`, also when an agent switched to Grok.
- The log now records a message that did not start because the provider refused the session or
  the turn.
