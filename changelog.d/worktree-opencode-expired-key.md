### Fixed

- An OpenCode agent now uses the OpenCode Go key that you paste into OpenBot. Before, an old key that `opencode auth login` saved took its place, so a turn failed with "This API key has expired" again after you replaced the key.
- An expired OpenCode key now shows "Your OpenCode API key expired" with an Update key button that opens the provider settings. Before, the chat showed "Internal error".
- A Workspace-only agent now uses a new provider key on its next turn. Before, it could keep the old key until it was idle for 10 minutes.
