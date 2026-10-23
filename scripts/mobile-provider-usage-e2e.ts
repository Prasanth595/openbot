// Drives the real mobile query/event pipeline over HTTP. The local host fixture broadcasts usage
// and status during its reply, as ProviderRuntime.usage does. No user host or provider is contacted.
// Run: bun scripts/mobile-provider-usage-e2e.ts. Writes .openbot-build/mobile-provider-usage-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { type AccountUsage, type AgentEvent, isAccountUsage } from "@openbot/contracts/ipc";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  invalidateProviderUsageQueries,
  syncProviderUsageQueries,
} from "../apps/mobile/src/features/workspace/model/provider-usage-cache";
import { type QueryScope, queryKeys } from "../apps/mobile/src/features/workspace/model/query-keys";

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const scope: QueryScope = ["https://account.example.test", "usage-fixture", 1];
const host = "usage-fixture-host";
const key = queryKeys.providerUsage(scope, host);
const accountKey = queryKeys.providerAccountUsage(scope, host);
const refreshMs = 5 * 60_000;
const status: Extract<AgentEvent, { type: "status" }> = {
  type: "status",
  status: {
    phase: "ready",
    cliVersion: null,
    auth: { kind: "unknown" },
    capabilities: { chat: "ready", browser: "unavailable", computerUse: "unavailable" },
    message: null,
    fullAccess: true,
  },
};
const initial: AccountUsage = {
  limits: [{ id: "codex", primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: null }, secondary: null }],
};
const reply: AccountUsage = {
  limits: [{ id: "codex", primary: { usedPercent: 24, windowDurationMins: 300, resetsAt: null }, secondary: null }],
};
let starts = 0;
let httpReads = 0;
const server = createServer((request, response) => {
  if (request.url !== "/v1/agents/usage") {
    response.writeHead(404).end();
    return;
  }
  httpReads++;
  // Stop a regressed client from running indefinitely before the assertions can fail.
  if (httpReads > 4) {
    response.writeHead(429).end();
    return;
  }
  syncProviderUsageQueries(client, scope, host, { type: "usage-changed", usage: reply });
  syncProviderUsageQueries(client, scope, host, status);
  syncProviderUsageQueries(client, scope, host, { type: "agents-changed", agents: [] });
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(reply));
});
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    server.off("error", reject);
    resolve();
  });
});
const address = server.address();
assert.ok(address && typeof address === "object");
const origin = `http://127.0.0.1:${address.port}`;
client.setQueryData(key, initial);
client.setQueryData(accountKey, initial);
const otherHost = queryKeys.providerUsage(scope, "other-host");
const otherUser = queryKeys.providerUsage([scope[0], "other-user", 2], host);
client.setQueryData(otherHost, initial);
client.setQueryData(otherUser, initial);
const observer = new QueryObserver(client, {
  queryKey: key,
  staleTime: refreshMs,
  queryFn: async () => {
    starts++;
    const response = await fetch(new URL("/v1/agents/usage", origin));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.ok(isAccountUsage(data));
    return data;
  },
});
let unsubscribe = observer.subscribe(() => {});
try {
  await observer.refetch({ cancelRefetch: false });
  assert.equal(starts, 1, "A usage reply/event must not start a second read.");
  assert.equal(httpReads, 1);
  assert.deepEqual(client.getQueryData(key), reply);
  for (let index = 0; index < 3; index++) {
    syncProviderUsageQueries(client, scope, host, status);
    syncProviderUsageQueries(client, scope, host, { type: "agents-changed", agents: [] });
  }
  assert.equal(client.getQueryState(key)?.isInvalidated, false, "Ordinary host events keep quota data fresh.");
  assert.equal(
    client.getQueryState(accountKey)?.isInvalidated,
    false,
    "Ordinary host events keep additional-account data fresh.",
  );
  unsubscribe();
  syncProviderUsageQueries(client, scope, host, status);
  syncProviderUsageQueries(client, scope, host, { type: "agents-changed", agents: [] });
  unsubscribe = observer.subscribe(() => {});
  assert.equal(observer.getCurrentResult().isFetching, false, "Reopening within five minutes reuses the reading.");
  assert.equal(starts, 1, "Opening the drawer again must not read quota after an ordinary message.");
  const pushed: AccountUsage = {
    limits: [
      {
        ...reply.limits[0],
        id: "claude",
        primary: { usedPercent: 45, windowDurationMins: 10_080, resetsAt: null },
        secondary: null,
      },
    ],
  };
  syncProviderUsageQueries(client, scope, host, { type: "usage-changed", usage: pushed });
  assert.equal(
    client.getQueryData<AccountUsage>(key)?.limits.length,
    2,
    "Progressive readings retain the other provider.",
  );
  assert.equal(starts, 1, "A pushed reading updates the cache without network work.");
  assert.deepEqual(client.getQueryData(otherHost), initial, "Other host data stays unchanged.");
  assert.deepEqual(client.getQueryData(otherUser), initial, "Other account data stays unchanged.");
  await observer.refetch({ cancelRefetch: false });
  assert.equal(starts, 2, "Manual refresh makes one further read.");
  assert.equal(httpReads, 2);
  syncProviderUsageQueries(client, scope, host, { type: "usage-changed", usage: { limits: [] } });
  assert.deepEqual(client.getQueryData(key), { limits: [] }, "An empty reading clears the old quota.");
  assert.equal(starts, 2);
  unsubscribe();
  client.setQueryData(key, reply, { updatedAt: Date.now() - refreshMs - 1 });
  unsubscribe = observer.subscribe(() => {});
  await observer.refetch({ cancelRefetch: false });
  assert.equal(starts, 3, "An expired five-minute reading loads once when the drawer reopens.");
  assert.equal(httpReads, 3);
  invalidateProviderUsageQueries(client, scope, host);
  await observer.refetch({ cancelRefetch: false });
  assert.equal(starts, 4, "A confirmed local account change refreshes the active quota reading once.");
  assert.equal(httpReads, 4);
  assert.equal(client.getQueryState(accountKey)?.isInvalidated, true, "A local account change expires account usage.");
  assert.equal(client.getQueryState(otherHost)?.isInvalidated, false, "A local change stays within its host.");
  assert.equal(client.getQueryState(otherUser)?.isInvalidated, false, "A local change stays within its account.");
  const out = ".openbot-build/mobile-provider-usage-e2e";
  await mkdir(out, { recursive: true });
  const report = {
    passed: true,
    boundary: "local HTTP host fixture and real mobile query/event pipeline",
    httpReads,
    queryStarts: starts,
    loop: false,
    progressiveEvents: true,
    ordinaryEventsKeepCacheFresh: true,
    warmReopenReusesReading: true,
    expiredReopenRefreshes: true,
    localAccountChangeRefreshes: true,
    hostAndAccountIsolation: true,
    deviceConnectionVerified: false,
  };
  await writeFile(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  unsubscribe();
  observer.destroy();
  client.clear();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}
