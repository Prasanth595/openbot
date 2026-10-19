### Fixed

- Run a message again to its end after the provider refused its first turn. Before, the second run
  of the message showed as interrupted while a Claude, ACP or Pi agent still worked on it. A Claude
  agent then refused each new message with "The Claude thread already has an active turn." until
  OpenBot restarted.
