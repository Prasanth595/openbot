### Fixed

- A reply that streams finds the earlier parts of its message from an index. Before, each update of a
  streaming reply read every earlier event of the chat, so a long chat streamed more slowly over time.
