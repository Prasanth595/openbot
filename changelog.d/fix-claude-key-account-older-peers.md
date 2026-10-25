### Fixed

- A server with a saved Anthropic API key no longer starts a Claude sign-in on the API key account when an
  older OpenBot version asks for one. That version shows the key as a signed-out account. The sign-in
  now stops with a message that tells you to change the key in Server settings › Providers.
