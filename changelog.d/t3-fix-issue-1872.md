### Added

- URL MCP servers have a "Sign-in app" section. Enter the client ID, an optional client secret and optional scopes of an OAuth app that you registered with the server's provider. OpenBot uses this app when the server cannot register OpenBot by itself. The section shows the exact callback URL with a copy button. On a joined server, the host keeps the app and signs in with its own browser.

### Security

- OpenBot keeps the client secret of a sign-in app in the encrypted sign-in store, shows only "Secret saved" after you save it, and removes it when you remove the server. Only an owner or admin can change a sign-in app on a joined server. A sign-in app is bound to the first sign-in server that accepts it, and OpenBot never sends it to a different one.

### Changed

- MCP sign-in now tries the same local callback port each time (28417), so the callback URL of a sign-in app stays the same. When the port is busy, OpenBot uses a random port.
