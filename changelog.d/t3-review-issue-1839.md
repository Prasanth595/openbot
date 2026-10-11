### Fixed

- Agents in a channel no longer read the thinking of other agents. Before, when one Claude agent
  in a channel had thinking text in its turn, Claude stopped every later assignment in that
  channel with a `reasoning_extraction` safeguard error until the channel summary covered the text.
  The channel still shows the thinking.
