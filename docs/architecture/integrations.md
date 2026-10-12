# Integrations and sign-in

This guide tells you how a sign-in reaches OpenBot, how a joined server signs in through the
computer of its user, and how to add a provider, an application or a connector. Each section has a
working example with real file paths.

- [How a sign-in reaches OpenBot](#how-a-sign-in-reaches-openbot)
- [Remote sign-in: the callback relay](#remote-sign-in-the-callback-relay)
- [Add a provider](#add-a-provider)
- [Add an application](#add-an-application)
- [Add a connector](#add-a-connector)
- [Add a Team API capability](#add-a-team-api-capability)
- [Test a sign-in through a joined server](#test-a-sign-in-through-a-joined-server)
- [What cannot be relayed](#what-cannot-be-relayed)

## How a sign-in reaches OpenBot

The computer that runs OpenBot keeps every grant. On a joined server, this is the host, not the
computer of the user who signs in. A sign-in uses one of these kinds:

| Kind | Example | On this computer | On a joined server |
| --- | --- | --- | --- |
| Loopback callback | URL MCP servers (`McpOAuth`), Codex browser sign-in, a page that an agent's CLI prints | The page sends the browser to `http://127.0.0.1:<port>/...`. The MCP listener uses port 28417 and path `/mcp-auth` ([`mcp-oauth-redirect-server.ts`](../../src/main/mcp-oauth-redirect-server.ts)). | The [callback relay](#remote-sign-in-the-callback-relay) (`sign-in-relay-v1`). MCP on an older host: the host's live view (`mcp-sign-in-v1`). |
| Device code | Codex (`codex-device`), Grok, Cline, Muse, the GitHub connector | The user types a short code on the provider's page. Nothing comes back to OpenBot. | The host starts it and the client shows the code (`providers-v1` to `providers-v5`). Muse: the relay opens its device page with no callback. GitHub: `connectors-v1`. |
| Pasted code | Claude on Linux (`cli` / `paste`), Cursor (`cli` / `link`) | The page shows a code, and the user pastes it into OpenBot. | The host starts it and the client takes the code (`providers-v3` to `providers-v5`). |
| CLI-owned browser login | Claude (`auth login`), Codex, Gemini (`acp-authenticate`) | The provider's CLI opens the browser and takes its own callback. | The relay (`provider/start`): the host captures the page, and the client sends the callback query to the CLI's listener on the host. Grok, Cursor and Cline: a code kind. |
| Deep link | Slack, Discord (`openbot://slack-workspace`, `openbot://discord-guild`), MCP fallback (`openbot://mcp-auth`) | A hosted page ends in an `openbot://` link, which reaches only the computer that opened it. | Slack and Discord: `connectors-v1`. The client sends the sealed grant on to the host that started the install. The browser client cannot receive the link. |
| Terminal | Pi | OpenBot opens the CLI in a terminal on the host ([`provider-terminal-login.ts`](../../src/backend/provider-terminal-login.ts)). | Sign in on the host. |
| Key or local session | API keys, 1Password, Bitwarden | The user types a key or gives a CLI session. | Keys go to the host over the encrypted channel. Vault approval stays on the host. |

The sign-in kinds of providers are in `ProviderSignIn` and `ProviderCodeSignIn` in
[`provider-drivers.ts`](../../src/backend/provider-drivers.ts). The kinds of applications are the
`auth` kinds of a catalog entry: `link`, `key` and `local`.

## Remote sign-in: the callback relay

The user is connected to a joined server, for example a cloud server. The host starts the sign-in,
but the sign-in page opens in the browser of the user's own computer. The user's browser keeps their
passwords, passkeys and sessions. After the user signs in, the page sends the browser back to a
loopback address. The user's OpenBot takes that callback and sends it to the host. The host finishes
the sign-in and keeps the grant.

The optional Team API capability `sign-in-relay-v1` carries the relay. The frozen contract is
[`sign-in-relay-v1.ts`](../../packages/contracts/src/team-protocol/sign-in-relay-v1.ts). It has
three start routes. They share `status`, `complete` and `cancel`:

| Start route | What it signs in | How the host delivers the callback |
| --- | --- | --- |
| `mcp/start` | A URL MCP server, from server settings or the Marketplace | It gives the code to `McpOAuth` (owned flow). |
| `provider/start` | The CLI of a provider in `SIGN_IN_RELAY_PROVIDERS`: Codex, Claude, Gemini (`antigravity`) and Muse | It replays the query to the CLI's own loopback listener on the host. A Muse device page has no callback: the client only opens it. |
| `link/start` | A sign-in page that an agent of the host printed in its conversation | It replays the query to the loopback address of that page. |

### Sequence

```text
User's computer (client)                        Host (joined server)
------------------------                        --------------------
POST mcp/start {config}  ---------------------> McpHostSignIns.startRelay: start the sign-in,
                                                open no tab, keep the page address
                         <--------------------- {flowId, expiresAt}
POST status {flowId}     ---------------------> SignInRelayHost.status
                         <--------------------- {authorizeUrl, callback {port, path, state}, result}
Read port, path and state from authorizeUrl
(refuse a page with no state)
Listen on that port (or use the own
MCP listener on 28417 /mcp-auth, by state)
Show the page's host name; the user clicks
"Open sign-in page" (https only)
        ... the user signs in ...
Browser -> http://127.0.0.1:<port><path>?code&state
POST complete {flowId, query} ----------------> check state, give code to McpOAuth
                         <--------------------- {result: null} -> read status until result
```

### Parts

| Part | File |
| --- | --- |
| Frozen wire contract | [`packages/contracts/src/team-protocol/sign-in-relay-v1.ts`](../../packages/contracts/src/team-protocol/sign-in-relay-v1.ts) |
| Host flows (single use, expiry, member, state) | [`src/main/sign-in-relay-host.ts`](../../src/main/sign-in-relay-host.ts) |
| Host route (`requireAdmin` on every route) | [`src/main/team-api/route-sign-in-relay.ts`](../../src/main/team-api/route-sign-in-relay.ts) |
| Host sign-in with no tab (`"relay"` mode) | [`src/main/host-sign-in-pages.ts`](../../src/main/host-sign-in-pages.ts), [`src/main/mcp-host-sign-ins.ts`](../../src/main/mcp-host-sign-ins.ts) |
| Client flow (listen, open, complete, paste) | [`src/main/sign-in-relay-client.ts`](../../src/main/sign-in-relay-client.ts) |
| Loopback listener checks (Host, method, path) | [`src/main/loopback-callback-server.ts`](../../src/main/loopback-callback-server.ts) |
| Desktop IPC (`servers:mcp:sign-in-relay`, `servers:mcp:open-sign-in-relay`, `servers:mcp:complete-sign-in-relay`) | [`src/main/ipc/mcp-server-handlers.ts`](../../src/main/ipc/mcp-server-handlers.ts) |
| Paste dialog | `McpSignInRelayDialog` in [`packages/ui/src/features/settings/McpSignInPage.tsx`](../../packages/ui/src/features/settings/McpSignInPage.tsx) |
| Browser client (paste only) | [`src/renderer/src/features/web-client/web-server-settings.ts`](../../src/renderer/src/features/web-client/web-server-settings.ts) |
| Marketplace | [`src/renderer/src/features/settings/marketplace-controller.ts`](../../src/renderer/src/features/settings/marketplace-controller.ts), [`web-marketplace.ts`](../../src/renderer/src/features/web-client/web-marketplace.ts) |
| Provider page capture on the host (`BROWSER` command, ACP link) | [`src/backend/agent/browser-capture.ts`](../../src/backend/agent/browser-capture.ts), [`src/main/provider-host-sign-ins.ts`](../../src/main/provider-host-sign-ins.ts) |
| Provider Connect on a joined server | [`src/main/ipc/provider-admin-handlers.ts`](../../src/main/ipc/provider-admin-handlers.ts), [`web-provider-relay.ts`](../../src/renderer/src/features/web-client/web-provider-relay.ts) |
| Agent links (`agent:open-message-link`, `agent:paste-message-link`, `agent:cancel-message-link`) | [`src/main/message-link-relay.ts`](../../src/main/message-link-relay.ts), [`web-message-link-relay.ts`](../../src/renderer/src/features/web-client/web-message-link-relay.ts) |

### How the client takes the callback

The client tries these, in this order:

1. **Its own MCP listener.** The callback names port 28417 and path `/mcp-auth`, and the client's
   own MCP grant listener has that port. The listener gives a `state` that no local sign-in started
   to `SignInRelayClient.deliver`. The `openbot://mcp-auth` link does the same.
2. **The exact port.** The client binds `127.0.0.1:<port>` for the time of the sign-in with
   `listenLoopbackExact`. It never takes another port, because the page sends the browser to the
   host's port.
3. **A pasted address.** The port is busy, the callback is not a loopback address, or the client is
   the browser client. The dialog asks the user to paste the address that the browser shows at the
   end. The client takes only the query and sends it with `complete`.

A page with no callback, such as the Muse device page, has nothing to take. The client opens it and
reads `status` until the CLI on the host ends the sign-in.

A host without `sign-in-relay-v1` falls back to the live view of `mcp-sign-in-v1`: the host opens
the page in its own private tab, and the user signs in through the live view. A host with neither
capability answers that the sign-in must be done on the host.

### Rules

- Only an owner or admin can use a relay route. `requireAdmin` runs on every route.
- `flowId` is 128 random bits. A flow completes once, only for the member who started it, and
  ends after `SIGN_IN_RELAY_TTL_MS` (10 minutes). An unknown flow, an expired flow and the flow of
  another member get the same `404`.
- The client sends only the query of the callback. The host checks `state` against the page address
  that its own sign-in made. A client can never choose a host port, host name or path.
- The host names a callback only for `http:` on `127.0.0.1`, `localhost` or `[::1]`, with a port.
- The host chooses the page, so a host that is not honest could ask for a grant of another account
  in the user's browser. The client therefore:
  - opens only an `https:` page, and only when the user clicks "Open sign-in page" in the dialog
    that shows the page's host name;
  - reads the callback port and path from the page's `redirect_uri`, not from the host's `callback`;
  - refuses a page with no `state`, so its listener hands on only the callback of this sign-in.
- The client listener refuses a request whose `Host` header is not a loopback name, a method that
  is not GET or HEAD, and any other path. Its page is a fixed catalog message.
- The code is a secret. The host calls `registerSecretValue` on it before delivery. No log line,
  analytics event or diagnostic export contains the code, the `state` or the query.
- The code travels only on the encrypted Team channel. The account Worker never sees it.
- Replay delivery sends one GET to the loopback address of the host's own page. It follows no
  redirect, keeps only the status code and drops the body.
- `link/start` accepts only an https page with a `state` and a loopback `redirect_uri`
  (`relayableSignInLink`), and only when an agent message of `agentId` from the last hour holds that
  exact address as a whole link (`agentPrintedLink`). Any other link gets `404`, so a client cannot
  make the host send a query to a port of its choice. The replay sends only what a click on that
  link on the host would send.
- An agent link opens at once, because the user clicked it. The desktop app opens it only when the
  page that the host names is the link that the user clicked; any other page ends the sign-in
  unopened. The browser client opens the link on the click, as before, because a browser blocks a
  page that no click opened; it accepts a pasted address only when the host names that same page.
- When the desktop app cannot bind the port, and always in the browser client, `openMessageLink`
  returns the page, and the conversation shows `McpSignInRelayDialog` with the paste field.
  `pasteMessageLink` ends when the sign-in ends; `cancelMessageLink` cancels it on the host.

### Security checklist for a new relay kind

- [ ] The host builds the full callback address from its own record. The client sends only a query.
- [ ] The host checks `state` before it delivers. The client refuses a page with no `state`.
- [ ] Nothing opens the page before the user sees its host name and asks.
- [ ] One flow completes once, for one member, before its deadline.
- [ ] The code is registered with `registerSecretValue` and never logged.
- [ ] The route uses `requireAdmin`, and its codec is in an optional capability (not in bootstrap).
- [ ] A test covers single use, the other member, expiry and a state mismatch. See
      [`src/main/sign-in-relay-host.test.ts`](../../src/main/sign-in-relay-host.test.ts).

## Add a provider

A provider is a coding agent CLI, such as Codex, Claude or Gemini. Read [Providers](providers.md)
first. The descriptor row and the driver are the start; the type checker then names most of the
other places.

1. **Descriptor.** Add the id to `AGENT_PROVIDERS` and a row to `AGENT_PROVIDER_DESCRIPTOR_TABLE` in
   [`packages/contracts/src/agent-providers.ts`](../../packages/contracts/src/agent-providers.ts):
   `displayName`, `cliName`, `authKind`, `signInMessage`, `codeSignIn`, `skillFolders` and the
   other fields. The table uses `satisfies Record<AgentProviderId, ...>`, so a missing row does not
   compile. Do not add to `AGENT_IDS_RESERVED_AT_RELEASE`: it is frozen.
2. **Driver.** Add a row to `BUILT_IN_PROVIDER_DRIVERS` in
   [`src/backend/provider-drivers.ts`](../../src/backend/provider-drivers.ts). Choose the sign-in:
   - `signIn`: `browser`, `cli-command`, `external`, `terminal` or `acp-authenticate`.
   - `codeSignIn` (optional): `codex-device`, `muse-device`, or `cli` with flow `device`, `paste`
     or `link`. A code sign-in is what lets a joined server sign in today.
   The dispatch is `#signIn` and `#startProviderCode` in
   [`provider-runtime.ts`](../../src/backend/agent/provider-runtime.ts). Reuse the helpers:
   [`acp-sign-in.ts`](../../src/backend/acp-sign-in.ts),
   [`cli-code-login.ts`](../../src/backend/agent/cli-code-login.ts),
   [`codex-login.ts`](../../src/backend/agent/codex-login.ts) and
   [`provider-terminal-login.ts`](../../src/backend/provider-terminal-login.ts).
3. **Backend.** `resolve<X>Cli` in `src/backend/cli.ts`, the state paths in
   `src/backend/process-confinement.ts`, `providerLabel` in `src/backend/agent/thread-items.ts` and
   `src/backend/agent/provider-diagnostics.ts`.
4. **Managed runtime** (when OpenBot installs the CLI): `native-runtime.lock.json`,
   `scripts/agent-runtime-lock.ts`, and `src/main/provider-runtime-descriptors.ts`,
   `provider-runtime-releases.ts` and `provider-runtime-manager.ts`.
5. **Contracts and preload.** The `AgentAuthState` arm in `ipc-agent-status.ts`, then
   `ipc-provider-admin.ts`, `src/preload/provider-runtime.ts` and `src/preload/agent-decoding.ts`.
6. **Renderer.** `SetupProviderPicker.tsx`, `ProviderSettingsSection.tsx`, `app-defaults.ts`, and
   the preview `mock-provider-runtimes.ts` and `app-test-harness.ts`.
7. **Logo.** The `ProviderLogoVariant` union and its SVG in
   [`packages/brand/src/ProviderLogo.tsx`](../../packages/brand/src/ProviderLogo.tsx), and the color
   in `packages/brand/src/tokens.css`.
8. **Team API.** The provider lists of a released capability are frozen. A new provider on a joined
   server needs a new `providers-vN` capability (see "Protocol compatibility" in
   [Providers](providers.md#protocol-compatibility)) and the peer rules in
   [`provider-visibility.ts`](../../src/main/team-api/provider-visibility.ts).
9. **Text and docs.** Error keys in `error/provider.ts` and onboarding text in all languages
   ([docs/i18n.md](../i18n.md)). A section in [Providers](providers.md), and a
   `changelog.d/<branch>.md` file.
10. **Tests.** `provider-runtime.test.ts`, `provider-visibility.test.ts` and
    `team-api-server.admin.test.ts`.

**Worked example: Codex browser sign-in.** The driver row uses `signIn: { kind: "browser" }`.
`CodexLoginFlow.startBrowser` in [`codex-login.ts`](../../src/backend/agent/codex-login.ts) asks the
Codex app-server for `account/login/start`, gets `authUrl`, and opens it with `openExternal`. The
Codex CLI takes the loopback callback by itself. For another computer, the row also has
`codeSignIn: { kind: "codex-device" }`: the host starts a device code, and the client shows it.

On a joined server with `sign-in-relay-v1`, Connect uses `provider/start`. The host runs the same
`startBrowser` in `"relay"` mode, so `openPage` keeps `authUrl` and opens no tab. The client opens
the page in its own browser and listens on the port of the page's `redirect_uri` (1455 in current
Codex releases). The host replays the callback query to the Codex listener on that port.

To relay a new provider, add it to `SIGN_IN_RELAY_PROVIDERS` before the capability ships, and give
the host its page:

- A CLI that honors `BROWSER`: run it with `captureBrowser` from
  [`browser-capture.ts`](../../src/backend/agent/browser-capture.ts). Claude does this.
- An ACP agent that prints its link: the `acp-authenticate` capture. Gemini does this.
- A CLI that returns the page address, such as the Codex app-server: give it to `openPage`.

A CLI that opens its own browser and honors no `BROWSER` cannot be relayed. Give it a code sign-in.

## Add an application

An application is an MCP server that the Marketplace installs, with optional skills. The source
is one folder per plugin in [`marketplace/plugin-catalog/`](../../marketplace/plugin-catalog/README.md).

1. Add `marketplace/plugin-catalog/plugins/<slug>/plugin.json`, and add the slug to `order` in
   `catalog.json`. The fields are `slug`, `name`, `tagline`, `description`, `category`,
   `creatorName`, `iconUrl`, `version`, `prompts`, `apps`, `skills` (`[]` for now) and the policy
   URLs. The types are in [`scripts/build-plugin-catalog.ts`](../../scripts/build-plugin-catalog.ts).
2. Each app has a `server`: `http` with a `url`, or `stdio` with a `command` and `args`. Its `auth`
   names how the user connects:
   - `link`: a browser sign-in. OpenBot is the OAuth client (`McpOAuth` in
     [`mcp-oauth-provider.ts`](../../src/backend/mcp-oauth-provider.ts)): discovery, dynamic
     registration, PKCE and refresh. The tokens stay in encrypted storage. No bridge program.
   - `key`: one or two fields that go into a `header` (http) or an `env` value (stdio).
   - `local`: steps that the user does on the computer that runs the server.
3. Never put a secret in the catalog. The user types it in the connect dialog.
4. Build and check the generated files:
   ```sh
   bun run marketplace:build:plugins
   bun run marketplace:build:plugins -- --check
   ```
   The build writes `src/renderer/src/features/settings/marketplace-plugin-catalog.ts`,
   `apps/auth-api/src/lib/plugin-catalog.generated.ts` and `resources/plugin-catalog/`. Do not edit
   them by hand.

A server that does not register OpenBot by itself needs a **sign-in app**: an OAuth app that the
admin registers with the provider. The user enters its client ID in the "Sign-in app" section of the
MCP server ([`McpSignInAppSection.tsx`](../../src/renderer/src/features/servers/McpSignInAppSection.tsx)).
The callback URL is `http://127.0.0.1:28417/mcp-auth`. On a joined server, the host keeps the app
(`mcp-sign-in-app-v1`).

**Worked example: Linear** (`marketplace/plugin-catalog/plugins/linear/plugin.json`):

```json
"apps": [
  {
    "id": "app-linear-mcp",
    "name": "Linear",
    "description": "Issue search, triage, status updates, and issue creation, over Linear's MCP server with browser sign-in.",
    "iconUrl": "https://linear.app/favicon.ico",
    "server": {
      "name": "linear",
      "transport": "http",
      "url": "https://mcp.linear.app/mcp",
      "auth": [{ "id": "linear-oauth", "kind": "link", "label": "Sign in" }]
    }
  }
],
```

On this computer, Connect opens Linear's page in the browser and the grant comes back on port 28417.
On a joined server with `sign-in-relay-v1`, the Marketplace installs the app on the host, and the
page opens in this computer's browser through the relay.

## Add a connector

A connector links OpenBot to an outside account for all agents. Each one has a main-process
service, an IPC contract and a settings panel.

| Connector | Service | Sign-in | Contract |
| --- | --- | --- | --- |
| GitHub | [`github-connector-service.ts`](../../src/main/github-connector-service.ts), `github-device-flow.ts` | Device flow of a GitHub App with only the public client ID | `ipc-github-connector.ts`; joined server: `connectors-v1` GitHub routes |
| Slack | `src/backend/messaging/slack/` | Hosted OAuth in the account Worker, which ends in `openbot://slack-workspace` with a sealed grant | `slack-workspace-grant.ts`, `ipc-messaging.ts` |
| Discord | `src/backend/messaging/discord/` | The same, with `openbot://discord-guild` | `discord-guild-grant.ts`, `ipc-messaging.ts` |
| Telegram | `src/backend/messaging/telegram/` | A one-use link code in a `t.me` link. No OAuth | `telegram-app.ts`, `ipc-messaging.ts` |
| 1Password | [`onepassword-connector-service.ts`](../../src/main/onepassword-connector-service.ts) | The user's `op` session creates a read-only service account, or the user pastes a token | `ipc-onepassword-connector.ts` |
| Bitwarden | [`bitwarden-connector-service.ts`](../../src/main/bitwarden-connector-service.ts) | A `bw` session key, kept in memory only | `ipc-bitwarden-connector.ts` |

To add a connector:

1. Add the IPC contract in `packages/contracts/src/ipc-<name>-connector.ts`, the handlers in
   `src/main/ipc/<name>-connector-handlers.ts` (read [src/main/ipc/AGENTS.md](../../src/main/ipc/AGENTS.md)),
   the preload decoders and the preview mock.
2. Add the service in `src/main/<name>-connector-service.ts`. Keep its secret in encrypted storage,
   and call `registerSecretValue` on every token before the first log line.
3. Prefer a device code: it works on any computer and through any joined server. A deep link
   (`openbot://...`) reaches only the computer that opened the page. Add its kind to
   [`deep-link-router.ts`](../../src/main/deep-link-router.ts), and keep a grant out of the renderer.
4. Add the panel from `@openbot/ui`, the text keys in all languages, and a
   `changelog.d/<branch>.md` file. Update `PRIVACY.md` when the connector sends new data out.

On a joined server, the optional capability `connectors-v1`
([`connectors-v1.ts`](../../packages/contracts/src/team-protocol/connectors-v1.ts), host route
[`route-connectors.ts`](../../src/main/team-api/route-connectors.ts)) carries GitHub, Slack, Discord
and Telegram:

- **GitHub**: the host runs the device flow. The client shows `userCode` and opens
  `verificationUri`. The host sees the sign-in by itself.
- **Slack and Discord**: the host answers the install page and a `nonce`, and opens nothing. The
  client opens the page. The install ends in an `openbot://` link on the client, with a grant that is
  sealed to a one-use key of the host. `RelayedMessagingInstalls`
  ([`relayed-messaging-installs.ts`](../../src/main/relayed-messaging-installs.ts)) sends the grant
  with `messagingComplete` only to the server whose install this computer opened, and only once. The
  client cannot open the grant.
- **Telegram**: the client opens the `t.me` link. There is no callback.
- No route carries a token. The overview drops the bot token.

A new connector on a joined server needs new routes in a new capability, because `connectors-v1`
is frozen once it ships.

## Add a Team API capability

A new remote feature is a new optional capability. Do not change a shipped capability: released
Team API adapters are permanent (see [Team API compatibility](team-api.md)). Worked example:
`sign-in-relay-v1`, which follows `mcp-sign-in-app-v1`.

1. **Frozen codec.** Add `packages/contracts/src/team-protocol/<name>-v1.ts`. Build each route with
   the helpers of [`admin-wire.ts`](../../packages/contracts/src/team-protocol/admin-wire.ts)
   (`adminRoute`, `fields`, `string(max)`, `nullable`). Export the capability name, the routes and
   the codec map. Write the header comment as the contract: what each route does and who can use it.
2. **Package export.** Add `"./team-protocol/<name>-v1"` to
   [`packages/contracts/package.json`](../../packages/contracts/package.json).
3. **Codecs.** Spread the codec map into `CODECS` in
   [`optional-routes.ts`](../../packages/contracts/src/team-protocol/optional-routes.ts).
4. **Capability list.** Add the capability to `TEAM_CURRENT_CAPABILITIES` in
   [`current.ts`](../../packages/contracts/src/team-protocol/current.ts), and exclude it from
   `TEAM_BOOTSTRAP_CAPABILITIES` and `legacyTeamCapabilities`. Older peers read a limited number of
   bootstrap capabilities, so a new optional one stays out of bootstrap.
5. **Host route.** Add `src/main/team-api/route-<name>.ts`. Return `"unmatched"` for other paths,
   refuse with `400` when the capability is off, and call `requireAdmin` for admin routes. Register
   it in `TeamApiServer.#handle` in [`team-api-server.ts`](../../src/main/team-api-server.ts), and
   advertise the capability in `#protocolSupport` only when its dependency is present. Add the
   dependency type to [`team-api/dependencies.ts`](../../src/main/team-api/dependencies.ts), and
   create it in [`application-services.ts`](../../src/main/application-services.ts), which passes it
   through [`host-service.ts`](../../src/main/host-service.ts).
6. **Client gate.** Add the capability to the explicit list in `serverSupportsCapability`
   ([`server-capabilities.ts`](../../src/renderer/src/features/servers/server-capabilities.ts)), so
   an older host that never sent it is not given the benefit of the doubt. In main, gate with
   `remoteServers.supportsCapability(serverId, CAPABILITY)`.
7. **Browser client.** Add the requests to
   [`team-admin-requests.ts`](../../packages/team-client/src/team-admin-requests.ts), and gate them
   on the host's capabilities in the web client.
8. **Fixtures.** Add accepted and refused payloads to
   [`optional-routes.test.ts`](../../packages/contracts/src/team-protocol/optional-routes.test.ts),
   and assert that the capability is not in bootstrap.
9. **Text.** Error messages use `sourceText(key)` with keys in all languages of `@openbot/i18n`.

## Test a sign-in through a joined server

1. Unit: run the relay host test and the listener test, one at a time:
   ```sh
   bun run test:desktop -- src/main/sign-in-relay-host.test.ts
   bun run test:desktop -- src/main/mcp-oauth-redirect-server.test.ts
   bun run test:desktop -- packages/contracts/src/team-protocol/optional-routes.test.ts
   bun run test:desktop -- src/main/sign-in-relay-client.test.ts
   bun run test:desktop -- src/main/relayed-messaging-installs.test.ts
   ```
2. Two clients: `bun run dev:test-client` starts the services, the app and a second client with its
   own profile (see [README.md: Commands](../../README.md#commands)). Join the app from the second
   client as an admin. Add a URL MCP server with OAuth on the host, and press Sign in on the client.
   The page must open in the client's browser, and the host must show the server as signed in.
3. Paste fallback: hold port 28417 on the client with another program, and sign in again. The dialog
   asks for the address. Paste the address from the browser. The host must sign in.
4. Browser client: open `/app` and sign in to the same server. The dialog shows "Open sign-in page"
   and the paste field.
5. Check the logs of both computers. They must not contain `code=`, the code or the `state`.

Use `bun run dev:automation` for snapshots and screenshots. Do not drive another worktree's app.

## What cannot be relayed

| Flow | Why |
| --- | --- |
| A sign-in that returns to a public `https:` address of the provider | The provider finishes it by itself. The host only waits. Nothing comes back to a loopback port. |
| A sign-in that opens an app on the host, such as Pi, which opens Terminal | The step happens on the host's screen. There is no page address to open somewhere else. |
| A vault that approves in its desktop app, such as 1Password or Bitwarden | The approval is in the vault app on the host. A relay cannot approve for it. |
| Slack and Discord in the browser client | A web page cannot receive the `openbot://` link that ends the install. Use the desktop app. |
| The Slack development return address (`returnUrl`) | Development builds only. It returns to `http://127.0.0.1:<port>/...` on the host, and the relay does not carry it. Use the hosted install. |
| An agent link for a member who is not an admin | The relay routes are admin only. The link opens as it is, and its callback cannot reach the host. |
| An agent link in a command, tool output or commentary | The host relays only a link that the text of an agent message holds. |
| A CLI that opens its own browser and honors no `BROWSER` | The host never gets the page address. Grok, Cursor and Cline use a code kind. |
| The iPhone app | It does not take relayed sign-ins. It keeps its current behavior. |
