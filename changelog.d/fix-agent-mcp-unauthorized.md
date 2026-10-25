### Fixed

- An OpenCode agent with more than one chat keeps its OpenBot tools. Before, about 10 minutes after
  its other chat went idle, every OpenBot tool call failed with `{"error":"unauthorized"}`, including
  routines, teammates and the browser, until OpenCode restarted.
