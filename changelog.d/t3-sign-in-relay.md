### Added

- On a joined server that supports it, the sign-in page of a URL MCP server now opens in the browser of your own computer, not in a tab on the host. Your passwords, passkeys and existing sessions work. OpenBot takes the callback on your computer and sends it to the host, and the host keeps the grant.
- When your computer cannot take the callback, OpenBot asks you to paste the address that the browser shows at the end of the sign-in. The browser client always uses this step.
- The Marketplace can now install an app that signs in with a browser on a joined server that supports this relay.
- New developer guide: `docs/architecture/integrations.md` shows how a sign-in reaches OpenBot and how to add a provider, an application or a connector.

### Security

- Only an owner or admin can start a relayed sign-in. Each relay completes once, only for the member who started it, and ends after 10 minutes. Your computer sends only the query of the callback. The host checks its `state` and never lets a client choose a host port or address. The page opens only when you click "Open sign-in page" in the dialog that shows its host name, and your computer refuses a page that has no `state`, so a host cannot use your browser for a grant you did not ask for. OpenBot does not log the sign-in code.
