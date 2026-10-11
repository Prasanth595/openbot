### Fixed

- Start custom agents that need Node or another tool from your shell when you open OpenBot from
  Finder, the Dock, or a login item. Before, they stopped with exit code 127. Check agent now uses
  the same `PATH`, and a `PATH` that you saved on the agent still wins.
