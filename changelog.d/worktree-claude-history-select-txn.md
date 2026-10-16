### Fixed

- Read Claude session history faster at start and after a provider reconnect. Before, OpenBot wrote
  each message of the selected conversation to its history index in a separate transaction, so a
  long session took seconds to read.
