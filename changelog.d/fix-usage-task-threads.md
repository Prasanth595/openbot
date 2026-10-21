### Fixed

- Usage analytics now count the tokens and the estimated cost of task turns. Before, a turn in a
  task stored no usage, for all providers. A Codex task that started before this version counts
  from its next request. A Grok task from before this version can count its earlier usage on its
  next turn.
- Codex usage now includes cache writes at the cache-write price. Before, a cache write counted as
  uncached input.
- A Codex request with 200,000 or more input tokens now gets an estimated cost. A request with more
  than 272,000 input tokens uses the long-context price.
- A Grok update with less than 200,000 input tokens now gets an estimated cost when the session has
  more. Before, the session total had to be less than 200,000.
- GPT-6.1 Sol, GPT-6 Sol and GPT-5.5 now have an estimated cost.
