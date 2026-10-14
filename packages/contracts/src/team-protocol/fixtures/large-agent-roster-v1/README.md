# Large agent roster v1 wire records

The one `large-agent-roster-v1` capability enables these records. The events require the capability
in the event scope. HTTP uses `OpenBot-Protocol-Version: 7`, `OpenBot-App-Version: 0.0.0`, and the
capability in `OpenBot-Capabilities`. Authentication is required. A missing capability keeps the
released route and its count bound.

These static fixtures record the wire shape with two representative agents. The first keeps its
marketplace provenance; the second uses Muse and a different avatar. They do not prove a count
above 100. The 14-case `scripts/local-agent-limit-e2e.ts` runs real stores and transports with
101 or more agents, validates near-budget roster and runtime events, and covers archive capacity
refusals, saved-data repair and old-peer update notices.

- `host-event.json` carries the new roster event with frozen v7 per-agent fields.
- `host-runtime-event.json` carries the two runtime agents and matching active turns. Per-agent
  usage holds are explicit fields of this new contract. A reset time is a non-negative finite
  number of epoch seconds or null. The wire uses `botId`. Frozen runtime events omit usage holds.
- `host-http-response.json` is the 200 body of `GET /v1/large-agent-roster/agents`.
- `client-http-request.json` is the body of `POST /v1/large-agent-roster/instance-transfer/export`.
  It also requires `instance-transfer-v1` and an owner or administrator.
- `host-transfer-response.json` is the 200 body of
  `POST /v1/large-agent-roster/instance-transfer/summary`, with the same permission requirements.

Each payload stays within the existing 1 MiB transport budget. Records use the frozen per-record
fields. A marketplace source keeps wire `agentId` for the listing. Clients translate that key to
`listingId` only after validation. These fixtures do not replace a released fixture.
