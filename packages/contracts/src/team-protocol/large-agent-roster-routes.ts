// Collection routes for the large-agent-roster-v1 capability. They are distinct from
// agent-import-v1 and instance-transfer-v1. They keep
// the released permissions, file budgets and record decoders. Each JSON reply remains within the
// existing 1 MiB HTTPS event budget. No released route or codec changes its count bound.
import { AGENT_ROSTER_BYTES_LIMIT, AGENT_ROSTER_ITEMS_LIMIT, fitsAgentRosterBudget } from "../agent-roster-limits";
import { isDynamicRecord } from "../runtime-values";
import { adminRoute, empty, type OptionalRouteCodec } from "./admin-wire";
import { AGENT_IMPORT_CODECS, AGENT_IMPORT_ROUTES } from "./agent-import-v1";
import { toCurrentAgentKeys, toWireAgentKeys } from "./current-agent-keys";
import { INSTANCE_TRANSFER_CODECS, INSTANCE_TRANSFER_ROUTES } from "./instance-transfer-v1";
import { projectedLargeAgentRoster } from "./large-agent-roster-v1";
import type { TeamProtocolV2Json } from "./v2";

const PREFIX = "/v1/large-agent-roster/";
const RELEASED_COLLECTION_COUNT = 100;
const ROSTER_ROUTE = "/v1/agents";
const BASE_ROUTES: ReadonlySet<string> = new Set([
  ROSTER_ROUTE,
  ...Object.values(AGENT_IMPORT_ROUTES),
  ...Object.values(INSTANCE_TRANSFER_ROUTES),
]);

const LARGE_ROSTER_CODEC: OptionalRouteCodec = {
  request: empty,
  response: (status, value) => {
    if (status >= 400) return adminRoute(empty, empty).response(status, value);
    const wire: TeamProtocolV2Json = JSON.parse(JSON.stringify(value));
    const roster = projectedLargeAgentRoster(toWireAgentKeys(wire));
    if (!fitsAgentRosterBudget(roster)) throw new Error("Large agent roster exceeds its transport budget.");
    return roster;
  },
};

/** Only clients translate the new roster route after its frozen per-record projection. */
export function largeAgentCollectionResponseToCurrent(path: string, value: TeamProtocolV2Json): TeamProtocolV2Json {
  return releasedAgentCollectionRoute(new URL(path, "http://openbot.invalid").pathname) === ROSTER_ROUTE &&
    Array.isArray(value)
    ? toCurrentAgentKeys(value)
    : value;
}

/** A negotiated client uses a new route; a peer without the capability keeps the released route. */
export function agentCollectionRoute(path: string, large: boolean): string {
  return large && BASE_ROUTES.has(path) ? path.replace("/v1/", PREFIX) : path;
}

/** Returns the released route name only for a registered large collection route. */
export function releasedAgentCollectionRoute(path: string): string | null {
  if (!path.startsWith(PREFIX)) return null;
  const released = path.replace(PREFIX, "/v1/");
  return BASE_ROUTES.has(released) ? released : null;
}

function projectCollections(
  value: unknown,
  keys: readonly string[],
  decode: (value: unknown) => TeamProtocolV2Json,
): TeamProtocolV2Json {
  if (!isDynamicRecord(value)) throw new Error("Invalid large agent data.");
  const empty = { ...value, ...Object.fromEntries(keys.map((key) => [key, []])) };
  const base = decode(empty);
  if (!isDynamicRecord(base)) throw new Error("Invalid large agent collection response.");
  const projected = { ...base };
  let bytes = new TextEncoder().encode(JSON.stringify(projected)).byteLength;
  for (const key of keys) {
    const entries = value[key];
    if (!Array.isArray(entries) || entries.length > AGENT_ROSTER_ITEMS_LIMIT)
      throw new Error("Invalid large agent collection.");
    const result: TeamProtocolV2Json[] = [];
    for (let index = 0; index < entries.length; index += RELEASED_COLLECTION_COUNT) {
      const part = decode({ ...empty, [key]: entries.slice(index, index + RELEASED_COLLECTION_COUNT) });
      if (!isDynamicRecord(part) || !Array.isArray(part[key])) throw new Error("Invalid large agent collection.");
      bytes += new TextEncoder().encode(JSON.stringify(part[key])).byteLength - 2 + (result.length ? 1 : 0);
      if (bytes > AGENT_ROSTER_BYTES_LIMIT) throw new Error("Large agent data exceeds its budget.");
      result.push(...part[key]);
    }
    projected[key] = result;
  }
  if (!fitsAgentRosterBudget(projected)) throw new Error("Large agent data exceeds its budget.");
  return projected;
}

function extendedCodec(
  released: OptionalRouteCodec,
  requestKeys: readonly string[],
  responseKeys: readonly string[],
): OptionalRouteCodec {
  return {
    request: (value) =>
      requestKeys.length ? projectCollections(value, requestKeys, released.request) : released.request(value),
    response: (status, value) =>
      status >= 400 || !responseKeys.length
        ? released.response(status, value)
        : projectCollections(value, responseKeys, (part) => released.response(status, part)),
  };
}

export const LARGE_AGENT_COLLECTION_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [agentCollectionRoute(ROSTER_ROUTE, true), LARGE_ROSTER_CODEC],
  ...[...AGENT_IMPORT_CODECS].map(([path, codec]): [string, OptionalRouteCodec] => [
    agentCollectionRoute(path, true),
    extendedCodec(
      codec,
      path === AGENT_IMPORT_ROUTES.apply ? ["keys"] : [],
      path === AGENT_IMPORT_ROUTES.stage ? ["agents"] : path === AGENT_IMPORT_ROUTES.apply ? ["agents", "skipped"] : [],
    ),
  ]),
  ...[...INSTANCE_TRANSFER_CODECS].map(([path, codec]): [string, OptionalRouteCodec] => [
    agentCollectionRoute(path, true),
    extendedCodec(
      codec,
      path === INSTANCE_TRANSFER_ROUTES.export ? ["agentIds"] : path === INSTANCE_TRANSFER_ROUTES.apply ? ["keys"] : [],
      path === INSTANCE_TRANSFER_ROUTES.summary || path === INSTANCE_TRANSFER_ROUTES.stage
        ? ["agents"]
        : path === INSTANCE_TRANSFER_ROUTES.apply
          ? ["agents", "skipped"]
          : [],
    ),
  ]),
]);
