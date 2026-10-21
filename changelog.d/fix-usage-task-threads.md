### Fixed

- Usage analytics now count the tokens and the estimated cost of task turns. Before, a turn in a
  task stored no usage, for all providers. A task that started before this version gets its earlier
  usage on its next turn.
- Codex usage now includes cache writes at the cache-write price. Before, a cache write counted as
  uncached input.
- Codex and Grok updates with 200,000 or more input tokens now get an estimated cost. A Codex
  request with more than 272,000 input tokens, or a Grok request with 200,000 or more, uses the
  long-context price.
- GPT-6.1 Sol, GPT-6 Sol and GPT-5.5 now have an estimated cost.
