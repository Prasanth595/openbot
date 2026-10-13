### Fixed

- Opening or writing to a chat no longer shows "Read state failed" when the read mark names a message
  that is not saved yet or was removed, such as a queued message on a hosted server. Before, every
  open and every send showed the error again.

### Changed

- When a queued message waits and no turn runs, the server log now names what holds the queue, so a
  queue that does not start can be diagnosed.
