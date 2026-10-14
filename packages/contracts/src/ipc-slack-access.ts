import { isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord, isString } from "./runtime-values";

export const SLACK_ACCESS_LIMITS = {
  connections: 32,
  scopes: 64,
  scope: 64,
  headerBytes: 2_048,
  responseBytes: 96 * 1_024,
} as const;

/** Metadata from a successful Slack auth.test response. It contains no credentials. */
export interface SlackAccessConnection {
  workspaceId: string;
  grantedScopes: string[] | null;
  verifiedAt: string | null;
  current: boolean;
}

export interface SlackAccessOverview {
  connections: SlackAccessConnection[];
}

/** Slack scope identifiers, including documented legacy perspectives and unnamespaced names. */
// https://docs.slack.dev/legacy/legacy-authentication/legacy-oauth-scopes/
export function isSlackScope(value: unknown): value is string {
  return (
    isString(value) &&
    value.length <= SLACK_ACCESS_LIMITS.scope &&
    /^(?:[a-z][a-z0-9_.-]*:[a-z][a-z0-9_.-]*(?::(?:user|bot|admin))?|admin|bot|client|commands|identify|incoming-webhook|post|read|tokens\.basic)$/.test(
      value,
    )
  );
}

export function isSlackGrantedScopes(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= SLACK_ACCESS_LIMITS.scopes &&
    value.every(isSlackScope) &&
    new Set(value).size === value.length &&
    value.join(",").length <= SLACK_ACCESS_LIMITS.headerBytes
  );
}

function isVerificationTime(value: unknown): value is string {
  return (
    isString(value) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

export function isSlackAccessConnection(value: unknown): value is SlackAccessConnection {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.workspaceId) &&
    (value.current === true
      ? isSlackGrantedScopes(value.grantedScopes) && isVerificationTime(value.verifiedAt)
      : value.current === false && value.grantedScopes === null && value.verifiedAt === null)
  );
}

export function isSlackAccessOverview(value: unknown): value is SlackAccessOverview {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.connections) &&
    value.connections.length <= SLACK_ACCESS_LIMITS.connections &&
    value.connections.every(isSlackAccessConnection) &&
    new Set(value.connections.map((connection) => connection.workspaceId)).size === value.connections.length &&
    new TextEncoder().encode(JSON.stringify(value)).byteLength <= SLACK_ACCESS_LIMITS.responseBytes
  );
}

/** The renderer/main and host/client boundaries each have their own result decoder. */
export function decodeHostSlackAccessOverview(value: unknown): SlackAccessOverview {
  if (!isSlackAccessOverview(value)) throw new Error("Invalid Slack access response.");
  return {
    connections: value.connections.map(({ workspaceId, grantedScopes, verifiedAt, current }) => ({
      workspaceId,
      grantedScopes,
      verifiedAt,
      current,
    })),
  };
}
