### Fixed

- A conversation and its unread count load from an index of the message order. Before, each load sorted
  the whole chat several times, so a client that opened many agents could stall OpenBot for seconds.
