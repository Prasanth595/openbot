### Fixed

- Claude usage now counts each turn once. Before, the first turn after OpenBot resumed a Claude
  session, such as after a restart or 10 minutes of idle time, counted all the earlier turns of the
  session again. The Usage view and its estimated cost showed too many tokens for Claude agents.
  Usage that was recorded before this version stays as it is. The first turn after a resume has no
  estimated cost.
