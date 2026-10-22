import type { McpServerConfig } from "@openbot/contracts/ipc";
import catalog from "../../../../../../marketplace/plugin-catalog/catalog.json";
import aave from "../../../../../../marketplace/plugin-catalog/plugins/aave/plugin.json";
import airtable from "../../../../../../marketplace/plugin-catalog/plugins/airtable/plugin.json";
import brave_search from "../../../../../../marketplace/plugin-catalog/plugins/brave-search/plugin.json";
import canva from "../../../../../../marketplace/plugin-catalog/plugins/canva/plugin.json";
import cobrain from "../../../../../../marketplace/plugin-catalog/plugins/cobrain/plugin.json";
import composio from "../../../../../../marketplace/plugin-catalog/plugins/composio/plugin.json";
import context7 from "../../../../../../marketplace/plugin-catalog/plugins/context7/plugin.json";
import figma from "../../../../../../marketplace/plugin-catalog/plugins/figma/plugin.json";
import firecrawl from "../../../../../../marketplace/plugin-catalog/plugins/firecrawl/plugin.json";
import linear from "../../../../../../marketplace/plugin-catalog/plugins/linear/plugin.json";
import notion from "../../../../../../marketplace/plugin-catalog/plugins/notion/plugin.json";
import paper from "../../../../../../marketplace/plugin-catalog/plugins/paper/plugin.json";
import posthog from "../../../../../../marketplace/plugin-catalog/plugins/posthog/plugin.json";
import resend from "../../../../../../marketplace/plugin-catalog/plugins/resend/plugin.json";
import sentry from "../../../../../../marketplace/plugin-catalog/plugins/sentry/plugin.json";
import stripe from "../../../../../../marketplace/plugin-catalog/plugins/stripe/plugin.json";
import vercel from "../../../../../../marketplace/plugin-catalog/plugins/vercel/plugin.json";

interface CatalogPlugin {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  creatorName: string;
  iconUrl: string | null;
  apps: {
    server: {
      name: string;
      transport: string;
      url?: string;
      command?: string;
      args?: string[];
      auth?: { kind: string; fields?: MarketAppAuthField[]; steps?: string[]; note?: string; docsUrl?: string }[];
    };
  }[];
}

export interface MarketApp {
  slug: string;
  name: string;
  description: string;
  tagline: string;
  category: string;
  creatorName: string;
  iconUrl: string | null;
  featured: boolean;
  config: McpServerConfig;
  signInOnHost: boolean;
  serverUrl: string;
  authFields: MarketAppAuthField[];
  setupSteps: string[];
}

export interface MarketAppAuthField {
  id: string;
  label: string;
  env?: string;
  header?: string;
  url?: boolean;
  prefix?: string;
  placeholder?: string;
  hint?: string;
  optional?: boolean;
}

// This is the canonical catalog source used by the desktop generator. No public JSON route ships yet.
const sources: CatalogPlugin[] = [
  aave,
  canva,
  linear,
  notion,
  cobrain,
  figma,
  paper,
  sentry,
  vercel,
  context7,
  stripe,
  posthog,
  airtable,
  firecrawl,
  brave_search,
  resend,
  composio,
];
export const MARKET_APPS: readonly MarketApp[] = sources.flatMap((plugin): MarketApp[] => {
  const server = plugin.apps[0]?.server;
  if (!server) return [];
  const fields = server.auth?.flatMap((flow) => flow.fields ?? []) ?? [];
  return [
    {
      slug: plugin.slug,
      name: plugin.name,
      description: plugin.description,
      tagline: plugin.tagline,
      category: plugin.category,
      creatorName: plugin.creatorName,
      iconUrl: plugin.iconUrl,
      featured: catalog.featured.includes(plugin.slug),
      signInOnHost: server.auth?.some((flow) => flow.kind === "link") ?? false,
      serverUrl: server.url ?? "",
      authFields: fields,
      setupSteps: server.auth?.flatMap((flow) => [...(flow.steps ?? []), ...(flow.note ? [flow.note] : [])]) ?? [],
      config: {
        id: "",
        name: server.name,
        transport: server.transport === "http" ? "http" : "stdio",
        enabled: true,
        url: fields.some((field) => field.url && !field.optional) ? "" : (server.url ?? ""),
        command: server.command ?? "",
        args: [...(server.args ?? [])],
        env: fields.flatMap((field) => (field.env ? [{ key: field.env, value: "" }] : [])),
        headers: fields.flatMap((field) => (field.header ? [{ key: field.header, value: "" }] : [])),
        envPassthrough: [],
        workingDirectory: "",
      },
    },
  ];
});

export function getMarketApp(slug: string): MarketApp | undefined {
  return MARKET_APPS.find((app) => app.slug === slug);
}

/** A matching name alone must never claim a user's unrelated MCP configuration. */
export function matchesMarketApp(config: McpServerConfig, app: MarketApp): boolean {
  const expected = app.config;
  if (config.name !== expected.name || config.transport !== expected.transport) return false;
  if (expected.transport === "http" && app.authFields.some((field) => field.url)) {
    try {
      const url = new URL(config.url);
      const host = new URL(app.serverUrl).hostname;
      return url.protocol === "https:" && (url.hostname === host || url.hostname.endsWith(`.${host}`));
    } catch {
      return false;
    }
  }
  return expected.transport === "http"
    ? config.url === expected.url
    : config.command === expected.command &&
        config.args.length === expected.args.length &&
        config.args.every((arg, index) => arg === expected.args[index]);
}
