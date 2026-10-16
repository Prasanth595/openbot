### Fixed

- Open an agent with very long messages from a remote device. Before, the connection to the server
  dropped and reconnected again and again. The server now sends fewer messages at a time, and you
  load the rest when you scroll up.
- Show an error when a server reply is too large to send to a remote device. Before, the server
  closed the connection.
