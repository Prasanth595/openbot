// Local-only Worker fixture. Wrangler supplies real persisted SQLite-backed D1.
// This entry never runs the account login service or sends an auth webhook.
import { Effect, Result, Schema } from "effect";
import { RemoteControlPlane, RemoteControlPlaneError } from "../apps/auth-api/src/server/remote-control-plane.ts";

const ACTORS = ["owner", "target", "ordinary", "reserve-a", "reserve-b"];
const changeSchema = Schema.Struct({
  role: Schema.optional(Schema.Literals(["admin", "member"])),
  reactivate: Schema.optional(Schema.Boolean),
});
const resumeSchema = Schema.Struct({
  sessionId: Schema.String,
  hostId: Schema.String,
  userId: Schema.String,
  membershipId: Schema.String,
  role: Schema.Literals(["owner", "admin", "member", "host"]),
  authEpoch: Schema.Number,
  sessionExpiresAt: Schema.Number,
});
const user = (id) => ({ id, email: `${id}@member-access.example.test`, name: `Fixture ${id}`, avatarUrl: null });
const json = (value, status = 200) => Response.json(value, { status });

async function run(operation) {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

export default {
  async fetch(request, env) {
    if (request.headers.get("X-Fixture-Key") !== env.FIXTURE_KEY)
      return json({ error: "Fixture access refused." }, 403);
    const actor = request.headers.get("Authorization")?.replace(/^Bearer fixture-account-/u, "");
    if (!ACTORS.includes(actor)) return json({ error: "Synthetic account required." }, 401);
    const plane = new RemoteControlPlane(
      {
        DB: env.DB,
        REMOTE_TICKET_PRIVATE_JWK: env.REMOTE_TICKET_PRIVATE_JWK,
        REMOTE_TICKET_PUBLIC_JWKS: env.REMOTE_TICKET_PUBLIC_JWKS,
        REMOTE_TICKET_KEY_ID: "member-access-fixture",
      },
      {
        fetch: () => {
          throw new Error("This fixture must not use an external service.");
        },
      },
    );
    const url = new URL(request.url);
    const hostId = "member-access-host";
    try {
      if (request.method === "GET" && url.pathname === "/fixture/ready") return json({ ready: true });
      if (request.method === "POST" && url.pathname === "/fixture/seed") {
        const now = Date.now();
        await env.DB.batch(
          ACTORS.flatMap((id) => [
            env.DB.prepare(
              "INSERT INTO users(id,identity_key,email,name,created_at,updated_at) VALUES(?,?,?,?,?,?)",
            ).bind(id, `fixture:${id}`, user(id).email, user(id).name, now, now),
            env.DB.prepare(
              "INSERT INTO auth_sessions(id,user_id,token_hash,expires_at,created_at,last_used_at) VALUES(?,?,?,?,?,?)",
            ).bind(`account-${id}`, id, `fixture-hash-${id}`, now + 86400000, now, now),
          ]),
        );
        await run(
          plane.registerHost(user("owner"), {
            hostId,
            name: "Member access fixture",
            ownerMembershipId: "membership-owner",
            devicePublicKey: "synthetic-member-access-device-key",
          }),
        );
        const joined = {};
        for (const id of ["target", "ordinary"]) {
          const invitation = await run(
            plane.createInvite(user("owner"), { hostId, role: id === "target" ? "admin" : "member" }),
          );
          joined[id] = await run(plane.acceptInvite(user(id), invitation.token));
        }
        return json({ hostId, joined });
      }
      if (request.method === "POST" && url.pathname === "/fixture/reserve") {
        for (const id of ["reserve-a", "reserve-b"]) {
          const invitation = await run(plane.createInvite(user("owner"), { hostId, role: "member" }));
          const membership = await run(plane.acceptInvite(user(id), invitation.token));
          await run(plane.changeMembership("owner", { hostId, membershipId: membership.membershipId, revoke: true }));
        }
        return json({ seeded: true });
      }
      if (request.method === "GET" && url.pathname === "/fixture/evidence") {
        const [memberships, sessions, events, hosts] = await env.DB.batch([
          env.DB.prepare(
            "SELECT membership_id,host_id,user_id,role,status,created_at,updated_at FROM remote_memberships ORDER BY user_id",
          ),
          env.DB.prepare("SELECT session_id,user_id,ended_at FROM remote_sessions ORDER BY session_id"),
          env.DB.prepare("SELECT payload FROM remote_auth_events ORDER BY created_at,event_id"),
          env.DB.prepare("SELECT host_id,auth_epoch FROM remote_hosts"),
        ]);
        return json({
          memberships: memberships.results,
          sessions: sessions.results,
          events: events.results.map((row) => JSON.parse(row.payload)),
          hosts: hosts.results,
        });
      }
      if (request.method === "POST" && url.pathname === "/fixture/start-session")
        return json(await run(plane.startSession(actor, hostId, `fixture-hash-${actor}`)));
      if (request.method === "POST" && url.pathname === "/fixture/validate-resume")
        return json({
          valid: await run(plane.validateResumeClaims(Schema.decodeUnknownSync(resumeSchema)(await request.json()))),
        });
      if (request.method === "GET" && url.pathname === "/v2/remote/hosts/")
        return json({ hosts: await run(plane.listHosts(actor)) });
      if (request.method === "GET" && url.pathname === `/v2/remote/hosts/${hostId}/members/`)
        return json({ members: await run(plane.listMembers(actor, hostId)) });
      const match = url.pathname.match(/^\/v2\/remote\/hosts\/([^/]+)\/members\/([^/]+)$/u);
      if (match && (request.method === "PATCH" || request.method === "DELETE")) {
        const input =
          request.method === "DELETE" ? { revoke: true } : Schema.decodeUnknownSync(changeSchema)(await request.json());
        await run(
          plane.changeMembership(actor, {
            hostId: decodeURIComponent(match[1]),
            membershipId: decodeURIComponent(match[2]),
            ...input,
          }),
        );
        return new Response(null, { status: 204 });
      }
      return json({ error: "Fixture route not found." }, 404);
    } catch (error) {
      if (error instanceof RemoteControlPlaneError)
        return json({ error: error.message, code: error.code }, error.status);
      return json({ error: "Local fixture failed." }, 500);
    }
  },
};
