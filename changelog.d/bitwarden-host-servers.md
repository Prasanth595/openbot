### Added

- Connect Bitwarden or a self-hosted Vaultwarden on a joined server. In Server settings › Connectors, an owner or admin enters the server address, the personal API key and the master password. The server signs in with its own Bitwarden CLI, downloads it when it has none, and unlocks again by itself after a restart. Agents on that server can then sign in to sites with the logins in the folder Shared with OpenBot. This works from the desktop app and the browser client.
