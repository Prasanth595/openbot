### Added

- On a joined server that supports it, you can now connect Codex, Claude, Gemini and Muse from your own computer. The sign-in page opens in your browser, and OpenBot sends the callback to the provider's CLI on the host.
- On a joined server that supports it, Server settings > Connectors now shows the host's GitHub, Slack, Discord and Telegram connections. You can connect, disconnect and reconnect them from your computer. The pages open in your browser, and the host keeps every token.
- When an agent on a joined server shows a sign-in link, for example for an MCP server of its CLI, the link opens in your browser and the sign-in finishes on the host.
- The browser client can now connect providers and install Marketplace apps that sign in with a browser on a joined server.

### Security

- The host relays an agent's sign-in link only when the link is an https page with a `state` that returns to a loopback address, and only when a message of that agent holds that exact link. A Slack or Discord grant goes only to the server whose install your computer opened, and only once. No connector route carries a token, and OpenBot does not log sign-in codes or grants.
