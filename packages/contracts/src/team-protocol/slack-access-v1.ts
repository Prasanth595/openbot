// Frozen optional slack-access-v1 wire contract. It exposes only current verified scope metadata.
// An owner or admin can read it. It does not change Slack action or member access permissions.
// A missing or invalid scope header, a paused connection or an invalid token is unknown.
// No credential, requested scope or persisted last-known observation is sent.
import { isDynamicRecord, isString } from "../runtime-values";
import { type AdminDecoder, adminRoute, empty, type OptionalRouteCodec } from "./admin-wire";

export const SLACK_ACCESS_CAPABILITY = "slack-access-v1";
export const SLACK_ACCESS_ROUTES = {
  overview: "/v1/admin/connectors/slack/access-overview",
} as const;

// https://docs.slack.dev/legacy/legacy-authentication/legacy-oauth-scopes/
function isScope(value: unknown): value is string {
  return (
    isString(value) &&
    value.length <= 64 &&
    /^(?:[a-z][a-z0-9_.-]*:[a-z][a-z0-9_.-]*(?::(?:user|bot|admin))?|admin|bot|client|commands|identify|incoming-webhook|post|read|tokens\.basic)$/.test(
      value,
    )
  );
}

const overview: AdminDecoder = (value) => {
  if (!isDynamicRecord(value) || !Array.isArray(value.connections) || value.connections.length > 32)
    throw new Error("Invalid Slack access overview.");
  const ids = new Set<string>();
  const connections = value.connections.map((connection) => {
    if (
      !isDynamicRecord(connection) ||
      !isString(connection.workspaceId) ||
      !connection.workspaceId.length ||
      connection.workspaceId.length > 128 ||
      ids.has(connection.workspaceId)
    )
      throw new Error("Invalid Slack access workspace.");
    ids.add(connection.workspaceId);
    const { workspaceId, current, grantedScopes, verifiedAt } = connection;
    if (current === false && grantedScopes === null && verifiedAt === null)
      return { workspaceId, current, grantedScopes, verifiedAt };
    if (
      current !== true ||
      !Array.isArray(grantedScopes) ||
      grantedScopes.length > 64 ||
      !grantedScopes.every(isScope) ||
      new Set(grantedScopes).size !== grantedScopes.length ||
      grantedScopes.join(",").length > 2_048 ||
      !isString(verifiedAt) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(verifiedAt) ||
      !Number.isFinite(Date.parse(verifiedAt)) ||
      new Date(verifiedAt).toISOString() !== verifiedAt
    )
      throw new Error("Invalid Slack scope observation.");
    return { workspaceId, current, grantedScopes, verifiedAt };
  });
  const decoded = { connections };
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 96 * 1_024)
    throw new Error("Slack access response is too large.");
  return decoded;
};

export const SLACK_ACCESS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [SLACK_ACCESS_ROUTES.overview, adminRoute(empty, overview)],
]);
