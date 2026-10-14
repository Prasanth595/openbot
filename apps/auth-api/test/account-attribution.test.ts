import type { DatabaseSync } from "node:sqlite";
import type { FirstTouch } from "@openbot/contracts/first-touch";
import { afterEach, describe, expect, it } from "vitest";
import { type AccountAnalyticsEvent, accountEventProperties } from "../src/server/account-analytics";
import { AccountAttribution, requestFirstTouch } from "../src/server/account-attribution";
import { runApiEffect } from "../src/server/effect-runtime";
import { migratedDatabase, migration, sqliteD1 } from "./sqlite-d1";

const databases: DatabaseSync[] = [];
const NOW = 1_800_000_000_000;
const TOUCH: FirstTouch = {
  acquisitionSource: "social",
  sourcePlatform: "reddit",
  landingPage: "/",
  firstVisitOn: "2027-01-10",
  utmSource: "reddit",
  utmCampaign: "launch",
};

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function insertUser(database: DatabaseSync, id: string): void {
  database
    .prepare(
      `INSERT INTO users(id, identity_key, email, created_at, updated_at)
       VALUES (?, ?, ?, 1, 1)`,
    )
    .run(id, `email:${id}@example.test`, `${id}@example.test`);
}

describe("account attribution", () => {
  it("keeps the previous schema usable and adds only the attribution table", () => {
    const database = migratedDatabase("0033_mobile_session_connect_link.sql");
    databases.push(database);
    insertUser(database, "existing");
    const before = database.prepare("SELECT id, email, created_at FROM users").all();
    database.exec(migration("0034_account_attribution.sql"));
    insertUser(database, "later");

    expect(database.prepare("SELECT id, email, created_at FROM users ORDER BY id").all()).toEqual([
      ...before,
      { id: "later", email: "later@example.test", created_at: 1 },
    ]);
    expect(database.prepare("SELECT COUNT(*) AS count FROM account_attribution").get()).toEqual({ count: 0 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("keeps the first touch of an account, links a recent checkout, and sends only allowlisted values", async () => {
    const database = migratedDatabase();
    databases.push(database);
    insertUser(database, "buyer");
    database
      .prepare(
        `INSERT INTO billing_sales_checkouts(
           session_id, return_token_hash, user_id, plan, interval, currency, amount, return_url,
           created_at, expires_at, updated_at
         ) VALUES (?, ?, 'buyer', 'starter', 'month', 'eur', 900, '/billing/return?cancelled=1', ?, ?, ?)`,
      )
      .run("cs_recent", "hash-recent", NOW - 60_000, NOW, NOW);
    database
      .prepare(
        `INSERT INTO billing_sales_checkouts(
           session_id, return_token_hash, user_id, plan, interval, currency, amount, return_url,
           created_at, expires_at, updated_at
         ) VALUES (?, ?, 'buyer', 'starter', 'month', 'eur', 900, '/billing/return?cancelled=1', ?, ?, ?)`,
      )
      .run("cs_old", "hash-old", NOW - 2 * 86_400_000, NOW, NOW);
    const events: AccountAnalyticsEvent[] = [];
    const attribution = new AccountAttribution({
      database: sqliteD1(database),
      analytics: { track: (_accountId, event) => events.push(event) },
      now: () => NOW,
    });

    await expect(runApiEffect(attribution.recordCheckout("cs_old", TOUCH))).resolves.toBe(false);
    await expect(runApiEffect(attribution.recordCheckout("cs_unknown", TOUCH))).resolves.toBe(false);
    await expect(runApiEffect(attribution.recordCheckout("cs_recent", TOUCH))).resolves.toBe(true);
    // A later touch never replaces the first one.
    const later: FirstTouch = { ...TOUCH, acquisitionSource: "search", sourcePlatform: "google" };
    await expect(runApiEffect(attribution.record("buyer", later, "sign_in"))).resolves.toBe(false);
    await expect(runApiEffect(attribution.read("buyer"))).resolves.toEqual(TOUCH);
    expect(events.map((event) => accountEventProperties(event))).toEqual([
      {
        surface: "account_api",
        environment: "production",
        event_schema_version: 10,
        recorded_via: "checkout",
        first_touch_source: "social",
        first_touch_platform: "reddit",
        first_touch_landing_page: "/",
        first_touch_date: "2027-01-10",
        first_touch_utm_source: "reddit",
        first_touch_utm_campaign: "launch",
      },
    ]);

    // A client value outside the allowlist is dropped, not stored or sent.
    expect(requestFirstTouch({ ...TOUCH, landingPage: "/app/secret-token" })).toBeNull();
    expect(requestFirstTouch({ ...TOUCH, acquisitionSource: "email" })).toBeNull();
    expect(requestFirstTouch({ ...TOUCH, utmCampaign: "buyer@example.test", utmTerm: "a b" })).toEqual({
      acquisitionSource: "social",
      sourcePlatform: "reddit",
      landingPage: "/",
      firstVisitOn: "2027-01-10",
      utmSource: "reddit",
    });

    database.prepare("DELETE FROM users WHERE id = 'buyer'").run();
    expect(database.prepare("SELECT COUNT(*) AS count FROM account_attribution").get()).toEqual({ count: 0 });
  });
});
