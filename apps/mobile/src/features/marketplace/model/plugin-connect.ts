import type { McpKeyValue, McpServerConfig } from "@openbot/contracts/ipc";
import type {
  MobilePlugin,
  MobilePluginApp,
  MobilePluginAuthField,
  MobilePluginAuthFlow,
} from "./plugin-catalog.generated";

/*
 * The connect rules of a plugin app, as the desktop and web Marketplace apply them
 * (`packages/ui/src/features/settings/mcp-connect-auth.ts` and `marketplace-plugins.ts`). Mobile
 * cannot import `@openbot/ui`, so they are stated again here. Keep both in step: the catalog build
 * checks that every key flow validates, and these functions decide what the phone saves on the host.
 */

/** What the user has typed in the current flow, keyed by field id. */
export type PluginAuthValues = Record<string, string>;

/**
 * How the phone connects an app, or why it cannot. The phone is always a remote client, so it follows
 * the joined-host rules of the desktop: a local server answers only on the computer that runs it, and
 * a browser sign-in needs a host that relays its sign-ins (`sign-in-relay-v1`).
 */
export type PluginConnectMethod =
  | { kind: "none" }
  | { kind: "key"; flow: Extract<MobilePluginAuthFlow, { kind: "key" }> }
  | { kind: "link"; flow: Extract<MobilePluginAuthFlow, { kind: "link" }> }
  | { kind: "local" }
  | { kind: "relayUnsupported" };

/** The flow the connect step opens on is the first the listing declares, as on the desktop. */
export function pluginConnectMethod(app: MobilePluginApp, canRelaySignIn: boolean): PluginConnectMethod {
  const flow = app.server.auth?.[0];
  if (!flow) return { kind: "none" };
  if (flow.kind === "local") return { kind: "local" };
  if (flow.kind === "link") return canRelaySignIn ? { kind: "link", flow } : { kind: "relayUnsupported" };
  return { kind: "key", flow };
}

/**
 * The configuration an app installs as. The id is empty, which the host's store reads as "new". A
 * credential is never part of it: the user types it, and `applyPluginKey` adds it.
 */
export function pluginAppConfig(app: MobilePluginApp): McpServerConfig {
  return {
    id: "",
    name: app.server.name,
    transport: app.server.transport,
    enabled: true,
    command: app.server.transport === "stdio" ? app.server.command : "",
    args: app.server.transport === "stdio" ? [...app.server.args] : [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: app.server.transport === "http" ? app.server.url : "",
    headers: [],
  };
}

/** The flow's required fields all have a value. */
export function pluginKeyComplete(fields: readonly MobilePluginAuthField[], values: PluginAuthValues): boolean {
  return fields.every((field) => field.optional || (values[field.id] ?? "").trim().length > 0);
}

/** The address is https and on the listing's host, or on a subdomain of it. */
function isListingUrl(value: string, listingUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = new URL(listingUrl).hostname;
  return url.protocol === "https:" && (url.hostname === host || url.hostname.endsWith(`.${host}`));
}

/** The first typed link that leaves the listing's host, or null. */
export function pluginKeyLinkError(
  config: McpServerConfig,
  fields: readonly MobilePluginAuthField[],
  values: PluginAuthValues,
): MobilePluginAuthField | null {
  for (const field of fields) {
    const value = (values[field.id] ?? "").trim();
    if (field.url && value && !isListingUrl(value, config.url)) return field;
  }
  return null;
}

/**
 * The configuration to connect with: the listing's base, plus the typed values in the places the
 * flow names. A value is written as typed, with only the prefix added; a blank value is left out.
 */
export function applyPluginKey(
  config: McpServerConfig,
  fields: readonly MobilePluginAuthField[],
  values: PluginAuthValues,
): McpServerConfig {
  const stdio = config.transport === "stdio";
  // A link is trimmed, unlike a credential: a space pasted around an address is never part of it.
  const link = fields
    .filter((field) => field.url)
    .map((field) => (values[field.id] ?? "").trim())
    .find(Boolean);
  const base = link && !stdio ? { ...config, url: link } : config;
  const written = fields.flatMap((field) => {
    if (field.url) return [];
    const key = stdio ? field.env : field.header;
    const value = values[field.id] ?? "";
    return key && value ? [{ key, value: `${field.prefix ?? ""}${value}` }] : [];
  });
  const kept = (pairs: McpKeyValue[]) => pairs.filter((pair) => !written.some((wrote) => wrote.key === pair.key));
  return stdio
    ? { ...base, env: [...kept(base.env), ...written] }
    : { ...base, headers: [...kept(base.headers), ...written] };
}

/**
 * Whether a row the host holds is the one this app installs. The name and the address (or the command
 * and its words) are compared, not the headers: the saved row carries the credential the user typed.
 */
function isPluginAppConfig(config: McpServerConfig, app: MobilePluginApp): boolean {
  const server = app.server;
  if (config.name !== server.name || config.transport !== server.transport) return false;
  if (server.transport === "http") {
    // A listing that asks for the user's own link cannot know the address, only its host.
    const userLink = (server.auth ?? []).some((flow) => flow.kind === "key" && flow.fields.some((field) => field.url));
    return userLink ? isListingUrl(config.url, server.url) : config.url === server.url;
  }
  return (
    config.command === server.command &&
    config.args.length === server.args.length &&
    config.args.every((arg, index) => arg === server.args[index])
  );
}

/** Every app of the plugin is a server on the host. */
export function pluginInstalled(plugin: MobilePlugin, servers: readonly McpServerConfig[]): boolean {
  return plugin.apps.every((app) => servers.some((config) => isPluginAppConfig(config, app)));
}
