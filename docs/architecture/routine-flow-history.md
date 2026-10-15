# Stored routine-flow history

The inspector can read older runs without starting a routine. Run pages use
`created_at DESC, run_id DESC`. Step pages use `created_at ASC, step_id ASC`. Each cursor stores
both values, so deleting the cursor row does not create a page gap. New runs do not change a page
already read. Reload starts again from the newest run.

`RoutineStore` reads run metadata without instructions or provider payloads. `RoutineFlows` checks
the routine owner and run owner. A joined caller must see the routine owner, current flow agents
and every stored participant of each requested run. The participant check includes removed links.
A missing or hidden run has the same public error. The authenticated Team route supplies agent
visibility. Request fields cannot replace it.

The new optional `routine-flow-history-v1` capability carries two POST reads. It is omitted from
legacy compatibility projections. `routine-flows-v1`, released events and protocol v1 through v7
keep their existing meanings. Current IPC has a separate `routineFlowHistory` group. Main and
preload keep separate decoders. Desktop and the web client use the same inspector and controller.

A run page has at most 20 runs. A step page has at most 10 steps. Each text field has a 4,096-byte
UTF-8 limit. The database reads a field only when it has at most 4,096 characters. Larger fields
remain in SQLite and are marked as omitted. Text within that scan bound is redacted before UTF-8
clipping. JSON responses have a 128 KiB limit. Extra text is omitted and marked if escaped JSON
would exceed that bound. The historical participant check examines at most 1,001 distinct IDs and
refuses a run above 1,000 participants. These bounds limit returned rows and application work;
they do not bound SQLite query planning or disk reads.

No schema or migration changes. No provider calls, delivery writes or flow sweeps on history reads.
Run execution status and stored step status do not report whether an external result was delivered.
The run status belongs to the routine's own agent. Each stored step has its own status, so a
successful owner run can still contain a failed downstream step.
The inspector shows selected stored steps below its run list. The canvas and active work continue
to show the newest run. A late response cannot replace another selected routine or run.

The first scope does not add a routine catalog, condition nodes, approval nodes, execution retry,
parallel work or a new canvas. Native mobile does not get a history editor in this change.
