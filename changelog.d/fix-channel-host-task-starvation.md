### Fixed

- Start the channel task that has waited longest for the host first. Before, a busy channel could
  start its newer tasks again and again while an older task of another channel stayed queued.
