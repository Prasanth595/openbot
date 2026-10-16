### Fixed

- Start faster when agents have a long chat history. Before, each start and each provider
  reconnect imported the full provider history of all agent sessions again. Now OpenBot imports
  only new or changed turns, and does not read a replaced session again after one complete import.
