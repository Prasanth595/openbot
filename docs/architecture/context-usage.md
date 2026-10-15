# Context usage estimates

The existing context ring uses the provider total and context window. Its total, pressure colors
and compaction behavior do not use category sums. Codex and ACP totals keep their existing path.

For Claude, the adapter retains safe category rows from native `context_usage` messages and the
existing `getContextUsage({ detail: "summary" })` control after a turn. The locked SDK says that
summary reads use the last response and local estimates. OpenBot does not request full category
counts or send another model turn to show the rows.

`ClaudeAgentClient` owns the cached report on its exact live `ThreadRuntime`. A category name maps
to a fixed public label ID. An unknown name gets a generic provider-category label. Native `kind`
and summary `isDeferred` stay separate. The adapter does not derive a kind from names or colors.
Memory-file paths, tool names, server names, colors, drilldown arrays and raw responses are not
retained by this feature. It reads at most 32 category rows and marks a longer list as truncated.
A valid total remains available when rows are missing or malformed. No category sum replaces it.

The pure getter starts no session and makes no SDK request. The provider lookup reads existing
client maps without extending the idle lifetime. It returns no report after the
runtime closes, restarts, changes model or compacts. Compaction also invalidates a pending summary
request, so a late response cannot restore the cleared report. The domain read checks the exact
agent Main thread, active provider session, public-thread binding and loaded client before and
after the getter. This first scope supports Main conversations only.

The optional `context-categories-v1` read has an 8 KiB response limit. Its current IPC mirror and
its host and preload decoders copy only safe fields. The host exposes it only when the read is
available. Protocol 6 bootstrap lists omit this capability. An unsupported joined host keeps its
existing behavior. A joined desktop or web client can use the same cached Claude total and window
as its meter anchor. Local context state takes precedence. The renderer refreshes on the existing
selected-conversation changes and runtime snapshots, and when the popover opens. It does not poll.
The controller coalesces invalidations into one read at a time and keeps a same-target estimate
while it refreshes. An old response cannot move to another host, agent or public thread.

The existing meter and popover show provider estimates. Rows can differ from the total. Deferred
schemas do not occupy the context window. A generic memory row does not distinguish OpenBot
memories from Claude harness memory. Native mobile category display, non-Claude categories and
file or tool drilldown remain outside this first scope.

## Conversation integration

An added local subject must supply an exact `contextCategoryTarget` that matches the selected
agent and public thread. It must not fall back to Main. The current domain refuses such a target.
When the conversation registry is accepted, its real user-thread ownership check must replace
the Main-only comparison in `ContextCategories.read`. The public binding, active-session and
loaded-client checks must remain. The released Main context snapshot stays unchanged. Verify
same-agent subjects and stale selection again before enabling that later extension.

## Verification

`bun scripts/context-category-usage-e2e.ts` drives the production Claude adapter through an
injected SDK stream. It uses real SQLite profiles and sessions, real context state, a loopback
Team route and the actual joined adapter. Its report records a run nonce and a fixed SHA-256
source manifest under `.openbot-build/context-category-usage-e2e/`. It covers two agents, exact Main
ownership, current and old-host reads, timeout, compaction, handoff, session replacement and restart.
Synthetic SDK responses prove integration. They do not prove provider estimate accuracy. Headless
popover review is separate from this service fixture. No live provider or account is required.
