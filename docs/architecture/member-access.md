# Member access actions

The member list lets a local host owner or a remote server owner use **Disable access** and
**Restore access**. Inactive non-owner records remain available in the list. The active member
count excludes them. Restore uses the existing seat limit. A refused restore keeps the inactive
record and permits another attempt after a seat becomes free.

These actions use the existing member APIs. No schema, released wire format or account-plane role
changes. The owner record stays protected. The UI exposes these new actions only to an owner.
The existing HTTPS route still permits an administrator to update non-owner members. The cloud
account service permits only the owner to change another member.

On HTTPS, disabling keeps the host member record and revokes its persisted sessions. It refuses
new HTTP calls and closes the event connection through the existing presence refresh. On the
account-plane transport, disabling revokes the cloud membership and ends its logical sessions.
The revoked server leaves the affected member's device lists. The cloud membership row stays and
can be restored. Restore does not make an ended session or resume token valid again.

The account service returns no complete member row after a change. The desktop and web adapters
retain the profile from their successful pre-change read and apply only the accepted role or
access fields. This is a saved mutation result, not a fresh profile read. The settings controllers
then refresh the roster. If that read fails, the saved fields remain visible with the existing
load error. Retry sends only a read. A refused mutation still leaves the confirmation available.
Phone keeps the accepted access field in its existing query cache before its separate refresh.

These operations do not add a distinct host-local pause, a member-facing paused notice, an actor
audit or maintenance mode. The list does not infer a reason for an inactive record. Cloud
directory sync continues to use its existing active and revoked membership meanings.

## Verification

`bun scripts/member-access-e2e.ts` uses a disposable real `TeamStore`, `TeamApiServer` and event
WebSocket. The production remote member adapter sends the real local requests. The cloud cases
start an isolated Wrangler child Worker with local SQLite-backed D1 and apply all actual account
migrations. Its routes call `RemoteControlPlane`. Synthetic account IDs supply the actor context;
the fixture does not test account login or real Signal delivery. The auth events remain in the
real durable outbox.

The same script starts background Storybook with `--ci --no-open` and headless Chromium. Its
controller fixture calls the real desktop and web settings controllers. Its private loopback
bridge sends membership writes to the real Team API. One refused roster read after an accepted
mutation proves that Retry sends only a read. The report is
`.openbot-build/member-access-e2e/report.json`. No token is included in the report.

Use the existing member access stories for visual review. Native phone alerts and rendering need
a separate device check. The E2E fixture does not verify full Signal or WebRTC revocation delivery.
