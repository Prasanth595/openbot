// Drives install receipts and complete agent reads through a local HTTP host and the mobile cache.
// No user host, account, provider or Marketplace is contacted.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { QueryClient } from "@tanstack/react-query";
import {
  type MarketAgentInstall,
  marketAgentInstallsKey,
  reconcileMarketAgentInstalls,
} from "../apps/mobile/src/features/workspace/model/market-install-receipts";
import type { QueryScope } from "../apps/mobile/src/features/workspace/model/query-keys";

const client = new QueryClient();
const scope: QueryScope = ["https://account.example.test", "market-fixture", 1];
const host = "market-fixture-host";
const key = marketAgentInstallsKey(scope, host);
const otherHost = marketAgentInstallsKey(scope, "other-host");
const otherAccount = marketAgentInstallsKey([scope[0], "other-account", 2], host);
let listed: { id: string }[] = [];
let failRead = false;
let releaseOldRead: (() => void) | undefined;
const oldReadArrived = Promise.withResolvers<void>();
const server = createServer((request, response) => {
  if (request.method === "POST" && request.url === "/install") {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "installed-agent" }));
    return;
  }
  if (request.url === "/agents?old") {
    const snapshot = [...listed];
    releaseOldRead = () => {
      releaseOldRead = undefined;
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(snapshot));
    };
    oldReadArrived.resolve();
    return;
  }
  if (request.url === "/agents") {
    response.writeHead(failRead ? 503 : 200, { "content-type": "application/json" }).end(JSON.stringify(listed));
    return;
  }
  response.writeHead(404).end();
});
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
assert.ok(address && typeof address === "object");
const origin = `http://127.0.0.1:${address.port}`;
async function read(path = "/agents") {
  const started = performance.now();
  const response = await fetch(`${origin}${path}`);
  if (!response.ok) throw new Error("Fixture agent list unavailable");
  const agents: { id: string }[] = await response.json();
  reconcileMarketAgentInstalls(client, scope, host, agents, started);
}
try {
  const old = read("/agents?old");
  await oldReadArrived.promise;
  const response = await fetch(`${origin}/install`, { method: "POST" });
  assert.equal(response.status, 200);
  const added: { id: string } = await response.json();
  const receipt: MarketAgentInstall = {
    listingId: "fixture-listing",
    agentId: added.id,
    installedAt: performance.now(),
  };
  client.setQueryData(key, [receipt]);
  client.setQueryData(otherHost, [receipt]);
  client.setQueryData(otherAccount, [receipt]);
  releaseOldRead?.();
  await old;
  assert.deepEqual(client.getQueryData(key), [receipt], "A list started before install must keep the receipt.");

  failRead = true;
  await assert.rejects(read(), /Fixture agent list unavailable/);
  assert.deepEqual(client.getQueryData(key), [receipt], "A failed refresh must keep the confirmed install response.");
  failRead = false;
  listed = [{ id: added.id }];
  await read();
  assert.deepEqual(
    client.getQueryData(key),
    [receipt],
    "A listed agent without source metadata still needs its receipt.",
  );

  // The host removed the agent while the phone missed its events. Reconnect reads a complete list.
  listed = [];
  await read();
  assert.deepEqual(client.getQueryData(key), [], "A later complete list must remove the absent agent's receipt.");
  assert.deepEqual(client.getQueryData(otherHost), [receipt], "Another host is unchanged.");
  assert.deepEqual(client.getQueryData(otherAccount), [receipt], "Another account is unchanged.");
  const out = ".openbot-build/mobile-market-install-e2e";
  await mkdir(out, { recursive: true });
  const report = {
    passed: true,
    checks: 7,
    boundary: "local HTTP host and real mobile receipt cache",
    userHostContacted: false,
  };
  await writeFile(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  // Machine-readable: fixture results only, with no user content or identifiers.
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  releaseOldRead?.();
  client.clear();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}
