# Memory architecture research

Status: proposed design for [#660](https://github.com/nightly-labs/openbot/issues/660).
Audited source: `81127888`, 2026-10-15. This document does not change the product.
The baseline script measures the existing services. It does not implement the proposal.

## Recommendation

Extend the local SQLite memory model in small stages. Keep the current essential selection and
on-demand recall. Add a bounded directory, durable source references, revisioned notes and a
review queue. Export notes as Markdown. Do not make Markdown files a second writable source of
truth. Do not add a remote memory service by default.

This serves a Linux VPS assistant that keeps a personal wiki across provider changes and
conversation resets. The first useful result is: save a decision with its evidence, find it after
a restart, correct it without an older review restoring it, and delete its retained memory text.
It does not require a new channel system, timer system or vector database.

## Current state

| Area | Confirmed behavior | Gap for a personal assistant |
| --- | --- | --- |
| Storage | [MemoryStore](../../src/backend/memory-store.ts) stores text, origin, `sourceTurnId` and dates in SQLite. Events and command receipts participate in each transaction. | No structured source URL, captured excerpt, semantic relation or review status. |
| Capacity | [Contracts](../../packages/contracts/src/ipc-agent-memories.ts) allow 500 characters per entry and 64, 128, 256 or 512 entries. Lowering the cap retains entries. | A longer decision note needs a separate durable record. Raising a cap does not make its contents discoverable. |
| Selection | [AgentMemoryStore](../../src/backend/agent-memory-store.ts) keeps essential/searchable selection separately. User choices take priority. The serialized essential block has an 8,192-byte budget. | Searchable entries have no subject directory. The count tells the agent that more facts exist, but not what they concern. |
| Recall | Local FTS5 `unicode61` search matches any literal query term, ranks with BM25 and returns at most ten entries. Listing is ID-paged. Both outputs are byte-bounded. | Synonyms, misspellings and multilingual paraphrases have no semantic expansion. No search over note bodies or external sessions. |
| Prompt | [Developer instructions](../../src/backend/agent/developer-instructions.ts) label memory as untrusted data. Only essential entries enter startup context. Claude receives full or changed memory blocks with turns to preserve its cached prefix. | There is no separate user identity profile or generated one-pager with source revision and freshness. The 8,192-byte limit covers the serialized memories, not the surrounding instructions. |
| Writes | [AgentMemories](../../src/backend/agent/agent-memories.ts) stages model writes until a turn completes. It checks ownership, selection revision, user control and capacity again at commit. | There is no durable background extraction queue. A restart discards staged work. Keep this behavior for incomplete chat turns. |
| Corrections | Manual updates clear the current `sourceTurnId`. Old memory events can still hold earlier text until deletion. Automatic store updates can use expected timestamps and selection revisions. | The panel and tools do not expose the retained history or distinguish a source claim from a user decision. Exact text deduplication does not resolve semantic conflicts. |
| Forgetting | Delete/clear removes the projection and prior events and their receipts. Selection and FTS triggers remove derived records. | This is logical deletion, not a claim of secure erasure from SQLite free pages, WAL, backups, exported files, provider history or retained source conversations. |
| History | [HistoryTools](../../src/backend/agent/history-tools.ts) reads the current conversation after its latest reset. Provider session import supports conversation reconstruction. | Neither is an opt-in learner for other apps' sessions. A memory source turn alone is not a durable evidence reader across resets. |
| Files | [Conversation file search](../../src/backend/database/conversation-queries.ts) searches attachment names. Agent workspaces and shared SQL tables hold longer material. | There is no general note-content index, bounded note-read contract or memory-to-file provenance. |
| Remote access | [Team API memory routes](team-api.md) require authentication and a visible agent. Existing text editing and the optional selection capability work independently. | Rich notes and source history need a new negotiated feature. Do not add fields to frozen memory codecs. |
| Other scopes | Messaging memory belongs to a connection. Agent memory belongs to an agent. | Equal ownership does not establish permission to share either scope. Retired channels are not a target. |

## Evidence from the reference systems

The two X links in #660 returned HTTP 403. The author's
[published Instinct report](https://supermemory.ai/blog/reverse-engineering-instinct-memory/)
was available. It reports a compact profile, task index, recap and searchable Markdown records.
It also states that the author did not inspect Instinct's source. Ingestion timing, summary
generation and forgetting remain observations or hypotheses. Its reported token sizes are not
OpenBot targets, and its informal quality assessment is not a benchmark.

[Supermemory profiles](https://supermemory.ai/docs/v5/api-reference/profiles/get-profile) separate
stable facts, evolving facts and optional buckets within a namespace.
[Ingestion](https://supermemory.ai/docs/v5/api-reference/ingest/add-document) processes documents
asynchronously and can append when a caller reuses a document ID. This is not a substitute for an
OpenBot idempotency receipt. An importer must not repeatedly append a complete transcript.
[Forget by ID](https://supermemory.ai/docs/v5/api-reference/content-management/forget-memories-by-id)
preserves audit history; [document deletion](https://supermemory.ai/docs/v5/api-reference/content-management/delete-documents)
has a different permanent-removal contract. Copying the former would weaken OpenBot's existing
forget behavior. These are documented vendor interfaces, not evidence of measured quality or
OpenBot data residency compatibility.

[MemGPT](https://arxiv.org/abs/2310.08560v2) studies movement between bounded prompt context and
larger external memory. It supports evaluation of a tiered design, but does not prove that a
particular tree or extraction model improves OpenBot.
[Claude Code](https://code.claude.com/docs/en/memory) loads a bounded Markdown index and reads topic
files on demand. [Hermes](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)
documents bounded persistent notes plus search over prior sessions. These are useful patterns
for discovery and history separation. Their scope and concurrency rules differ from OpenBot's
multi-agent host and remote clients.

| Reference idea | Decision | Reason |
| --- | --- | --- |
| Compact profile and one-pager | Adopt as a derived, revisioned view | Avoid repeated broad recall; show source revision and freshness. Never turn a learned preference into permission. |
| On-demand search and reads | Retain and extend | Current local FTS and bounded tools already provide the correct foundation. |
| Short pointer directory | Adopt in stages for #1836 | Names and aliases help the agent know what to search. Measure discoverability before semantic infrastructure. |
| Longer Markdown notes | Adopt as export/import format | SQLite retains atomic writes, access checks and source identity. Explicit imports can detect revision conflicts. |
| Background extraction | Adopt with review, limits and durable cursors | A delayed job must not block an answer or overwrite a user correction. |
| Task board in memory | Reject as authoritative task state | Read a bounded view from the task owner. A summary must not complete a task, change a schedule or create approval. |
| Compaction recap as durable truth | Reject | It belongs to its conversation and may omit or misstate evidence. Read it as historical context only. |
| Git history or an archive that never deletes | Reject | A real forget must remove retained memory text and its derived views. History has a separate lifecycle from deletion. |
| Daily full-transcript reprocessing | Reject | It grows cost, repeats sensitive input and can restore superseded facts. Process bounded changed source units. |
| Hosted Supermemory as the default store | Reject | SQLite must remain the local source of truth. Remote ingestion would need a separate opt-in product and privacy decision. |
| Embeddings or automatic query rewriting now | Defer | The current baseline establishes lexical limits, not a benefit or acceptable cost for either addition. |

## Proposed records and boundaries

These are design fields, not shipped contracts or migration SQL. A future schema owner must
define validated internal types and separate negotiated external codecs.

| Record | Proposed minimum fields | Rule |
| --- | --- | --- |
| Knowledge scope | Stable ID, kind, owner ID | Start with existing private agent scopes. Cross-agent and team sharing is deferred and needs a separate accepted access design. |
| Source unit | Stable ID, scope, source kind, source identifier, locator, source time, capture time, content digest | Evidence excerpts belong to the note revision or candidate that retains them, so forgetting that record can remove its captured text. A URL alone is not evidence. |
| Note | Stable ID, scope, title, aliases, body, kind, revision, status, source IDs, valid-from/until, updated time | Proposed body limit: 64 KiB. Reads return bounded sections, not the whole body. A note can be a decision, preference, sourced claim or agent inference. |
| Note revision | Note ID, revision, previous revision, reason, actor, source IDs, bounded redacted evidence excerpts and retained text | Reviewable history for corrections. Delete/forget purges retained text for the note, not merely its current revision. |
| Candidate | ID, destination scope, source unit IDs, extraction version, proposed operation, target ID/revision, review status | Inference stays a candidate until the configured review policy accepts it. Scope routing happens before retrieval or model input. |
| Directory/one-pager | Scope, generation, covered source revision, generated time, included note IDs/revisions, bounded text | Derived and rebuildable. Never the only retained representation of a fact. |
| Extraction cursor | Source adapter, permitted root, destination scope, file identity, committed offset, last successful run, safe failure status | Advance only after candidate persistence commits. Detect truncation/rotation. Stop at a partial record. |
| Suppression | Scope, opaque source-unit identity, deletion generation | Prevent a later job from restoring forgotten imported text. Keep no excerpt or deleted fact in the suppression record. Treat its identifiers as private metadata. |

Illustrative Markdown export, containing synthetic data:

```markdown
---
format: openbot-note-v1
id: note-boreal-choice
scope: agent-personal-assistant
revision: 2
kind: decision
title: Personal wiki hosting
aliases: [hosting decision, personal wiki]
status: current
source_ids: [source-user-decision, source-article-capture]
updated_at: 2026-10-15T09:00:00Z
---
The user chose Boreal to keep the wiki on their VPS.

## Evidence
- User decision: synthetic message `message-choice`, captured 2026-10-15.
- Article claim: https://example.com/hosting, captured 2026-10-14.
  Retained excerpt: "The example service can run on a private server."

## Correction
Revision 2 corrects the chosen host. Revision 1 is superseded, not current.
```

Export a manifest with format version and source/revision references. Import verifies the expected
revision, detects unchanged content and reports conflicts. Do not silently overwrite a database
record when an exported file changes. Existing workspace files remain user files; importing one
does not grant access to adjacent paths or make it shared.

The proposed note store does not inherit the 64-entry default for short saved facts. It keeps
longer records behind pointers, with per-record and per-response limits. Measure disk growth and
expose a configured storage quota. At quota, refuse a new capture with a visible reason; never
delete or compress retained evidence automatically to make space.

The authenticated router derives the requester and allowed scopes. An agent cannot widen these
through tool arguments. Default recall stays inside that agent. A user profile is explicit
owner-managed information selected for a specific agent, not an automatic union of every agent's
memories. Messaging connection memory remains private to its connection. Desktop, mobile and web
must apply the same host checks. Cross-agent and team sharing is deferred; the declined #1928 team
memory proposal is not a dependency of personal notes, correction or forgetting.

Logical isolation does not stop a full-access coding agent from reading files as the same OS user.
Do not describe these scopes as an OS sandbox. The existing database is not application-encrypted.
Keep host filesystem permissions and recommend disk encryption for deployment. Application-level
encryption needs a separate key, recovery and search-index design before any guarantee is made.

## Data flow and conflict rules

1. An explicit save captures a bounded source unit and a note in one local transaction. Source
   claims, the user's decision and agent inference have different kinds. Exact command receipts
   make retries idempotent. A duplicate source capture must not create a second note.
2. A completed chat turn or an opted-in external source can enqueue extraction. The job reads only
   its permitted, changed source units. It redacts before model input, uses a capped batch and
   persists candidates before it advances a cursor. Stop/restart resumes uncommitted work.
3. Review compares a candidate with the current target revision and evidence. Newer timestamps
   alone cannot establish truth. Distinct facts can coexist. A contradiction creates an explicit
   superseding relation or a review item; it does not erase an unrelated fact.
4. A user correction writes a new revision and reason atomically. The old source remains evidence
   of the earlier claim, not current truth. Pending work with an older revision is rejected.
5. A successful change invalidates the directory and one-pager generation. Regeneration uses a
   snapshot of accepted records and their revisions. If these change before commit, discard that
   derived result. An old view cannot reinsert a deleted fact.
6. Forget increments the scope's deletion generation and removes the selected note's current text,
   retained revisions, captured evidence excerpts, candidates and derived search/view text in one transaction. Cancel or reject
   pending jobs from an older generation. Keep minimal opaque source suppression to prevent import
   replay. Make removal of the source conversation or document a separate explicit choice.

Define the user's deletion target clearly. Removing one note does not remove independently saved
notes that happen to discuss the same fact. A scope-wide fact-removal action must show its matching
notes and derived dependencies before it deletes them. No forgotten note may remain readable
through its revision history, evidence captures, candidates or generated files owned by OpenBot.

Keep chat-turn staging and background extraction separate. An interrupted conversation must not
commit staged model mutations. Background jobs own cancellable scopes and shutdown finalizers,
with their durable queue remaining in SQLite. Reuse the routine scheduler for periodic review.
Do not replay an uncertain remote mutation. Limit extraction concurrency to one job per scope,
with fair scheduling across scopes and the existing host resource limits.

For #1634, each source is off by default and configured per destination agent. Select explicit
directories and source adapters. A VPS cannot discover sessions that remain on the owner's laptop;
remote transfer needs its own explicit, encrypted, authenticated mechanism. A keyword filter can
propose routing, but must keep correction context around the matching exchange. Do not import
raw provider reasoning or assume that an external suggestion is a user decision. Show sources,
safe failure status and review results to the owner. Disabling a source stops reads and queued work;
the owner can separately retain or delete prior accepted facts.

## Retrieval and prompt composition

Keep the current serialized essential-memory limit of 8,192 UTF-8 bytes. User-pinned entries have
priority. A directory and one-pager must fit in unused space in a future combined budget; they must
not silently evict pinned facts or add an unbounded second block. If no space remains, expose them
through a tool. Show that fact rather than dropping a subject without notice. Preserve Claude's
turn-based updates and cache behavior.

The directory contains reviewed titles, aliases, IDs and when to read a topic. Its proposed text
ceiling is 2,048 bytes within the combined budget. Overflow becomes paged topic directories, not
loss of note content. Start with a bounded directory over current searchable entries for #1836.
Longer notes and deeper pointers follow after the note store exists. Do not automatically turn
the first words of arbitrary memory text into a trusted subject or instruction.

Search indexes accepted current note titles, aliases, body sections and permitted source excerpts.
Keep literal FTS as the initial mechanism. Scope filtering is part of the query, before ranking.
Return IDs, revision, source time and capture time with bounded excerpts. Read by ID requires the
same authorization and returns a section cursor. Historical versions are available only when the
user or task asks for history; mark them superseded. Stale claims require verification for actions
that depend on present truth. A failed fetch is not proof that the old source claim is false.

A one-pager is a convenience view of accepted facts. Proposed profile categories include life/work
context and communication preferences. Approval preferences can describe the user, but cannot
grant tool permission or override the current request. Label inferred traits and show last refresh
and covered revision. If the view is stale, use current records or explicitly marked older context.
Do not wait for regeneration before answering.

Keep task and compaction context outside durable fact authority. Routines own their next run and
run status. Current task plans and waits own their completion state. A bounded index links to those
owners and has an as-of time. A provider recap stays scoped to its conversation, is untrusted and
does not become a cross-agent wiki entry without separate source-backed capture.

## Privacy, retention and migration

Local accepted notes and indexes stay on the host. Only the bounded context needed for the current
request goes to its configured provider. Background extraction is a separate opt-in outbound
operation, even when it uses that same provider. Show its model, scopes, input cap and cost limit.
Secret redaction is required before persistence, export, logging and sending. It does not guarantee
removal of all private prose; source consent and input minimization remain necessary.

Private source content must not enter telemetry. Diagnostics can contain counts, generations and
safe errors. URL credentials and secrets must not survive in locators. Source IDs and excerpts need
the note's access rules. Future sharing would require review of the source references and retained
history too. A short profile can contain sensitive information and gets no weaker rules.

Define retention separately for raw captures, candidates and accepted notes. Proposed defaults:
discard rejected candidate text after 30 days; retain accepted notes until the owner removes them;
retain only explicitly selected bounded evidence, not full transcripts. The first implementation
must expose these settings and deletion effects. Backups and exports are copies the user owns;
show that local deletion cannot remove a copy or retract data already sent to a provider.

Future schema changes append a migration and update the separate latest schema. Preserve existing
IDs, text, dates, caps and inclusion choices. Copy a legacy `sourceTurnId` as a legacy locator with
unknown evidence availability; do not fabricate a captured excerpt. A null source stays unknown.
No automatic bulk model inference or network call occurs during migration. Existing memories stay
readable if note adoption is disabled. Released Team adapters keep their meaning. Rich note routes
need a new capability or protocol with old-client/new-host and new-client/old-host verification.

## Baseline and acceptance gates

Run `bun scripts/agent-memory-baseline-e2e.ts`. It uses the production `OpenBotDatabase`,
`AgentMemoryStore` and memory prompt serializer with temporary synthetic SQLite data. It writes
`.openbot-build/agent-memory-baseline-e2e/report.json` and removes its temporary database. It checks
literal recall and records synonyms, Korean grammatical variants and Japanese substring recall
at 64, 128 and 512 entries. It also measures prompt bytes and warmed local search P50/P95.
It checks agent isolation, paged listing, correction,
stale-write rejection, exact deduplication, close/reopen, forget and clear.

The final root-run report passed on 2026-10-15 with Bun 1.4.2 on local macOS ARM64. Its
`nodeCompatibilityVersion` is Bun's reported `v26.3.0`, not the version of a separate Node
executable. Each corpus has the same six target facts and synthetic archive entries. Two facts
are explicitly selected as essential; their serialized block is 287 bytes at every corpus size.

| Records | Literal targets found | Nonliteral targets found | Full memory turn bytes | Warm search P50 (ms) | Warm search P95 (ms) |
| --- | --- | --- | --- | --- | --- |
| 64 | 6/6 | 0/6 | 758 | 0.064875 | 0.072709 |
| 128 | 6/6 | 0/6 | 760 | 0.088542 | 0.100000 |
| 512 | 6/6 | 0/6 | 760 | 0.262250 | 0.330791 |

Timing covers only the one-match `Boreal` query, with five warm-up calls and 30 measured calls
per corpus. The complete maintenance listing took 5, 10 and 37 pages respectively, with no
duplicate or missing record. All recorded correction, stale-write, deduplication, close/reopen,
forget and clear checks passed.

The nonliteral cases include `제주` for saved `제주도로` and `東京` within an unbroken Japanese
phrase. The `hosting decision` query returned five archive entries but missed the actual hosting
choice. A nonempty result is therefore not proof of correct recall. These results match the
current literal-term search contract; they do not show a broken FTS index.

This small baseline supports testing a subject directory and aliases. It does not establish
semantic retrieval or model answer quality. No provider, VPS workload or proposed extractor was
run. Source navigation, transport compatibility and encryption are also unverified. No timing
threshold is enforced on a contributor's computer.

Before implementing a stage, fix a synthetic evaluation set and acceptance thresholds:

| Measure | Required scenario | Proposed release gate |
| --- | --- | --- |
| Evidence quality | At least 100 labelled queries over decisions, source claims, corrections, stale facts and absent facts | At least 95% supported answers and zero unsupported present-tense claims in the correction/absence subset. Human review against cited evidence. |
| Discovery | Compare current recall against the bounded directory on the same literal, alias, paraphrase and multilingual queries | At least 95% Recall@5 for literal/explicit-alias queries. Measure other categories separately; never turn the synthetic score into a universal guarantee. |
| Context cost | Record exact provider token counts for the same tasks and provider version | Memory context stays within its combined byte limit. Median tokens do not rise on tasks that need no recall. Target at least 50% fewer tokens than a full-note baseline, with equal supported-answer quality. |
| Local latency | 64/128/512 notes, then 10,000 notes on a declared VPS configuration | Report cold/warm P50/P95, query plan, CPU and database size. Initial target: warm retrieval P95 under 50 ms; chat-start P95 increases by at most 20 ms without provider extraction on the critical path. |
| Freshness | Correct or forget a fact while extraction and view generation are in progress | Current search and prompt state update at commit. All stale generations fail to publish. Optional extraction completes within five minutes after an idle slot; backlog is visible. |
| Restart/retry | Interrupt capture, candidate commit, cursor commit and view generation independently | Restart resumes each durable job without a duplicate note or cursor skip. No incomplete source record is accepted. |
| Correctness | Concurrent manual edits, stale imports, source rotation and explicit supersede | No silent lost update, no unrelated fact overwritten, no deleted-text restoration. Revision conflict is visible. |
| Permissions | Two agents, one private messaging scope and old/new clients | Zero unauthorized result or excerpt through search, read, export or history. Sharing is not enabled by this plan. Test only synthetic owned fixtures. |
| Cost | Repeated review, 1,000 changed source units and an unchanged rerun | Report model/version, input/output tokens and actual metered cost. Unchanged rerun makes zero extraction calls. Exceeding the configured budget pauses extraction without blocking chat. |

These are proposed gates, not achieved measurements. Expand beyond the small baseline with fixed
synthetic cases before selecting an extraction model or adding semantic retrieval. Evaluate at
least two providers and repeated runs; store model versions, prompt versions and adjudication.

## Implementation sequence

| Stage | Scope and completion evidence | Dependency |
| --- | --- | --- |
| 1 | #1836: bounded searchable subject directory using existing memory storage, preview and measured discoverability. Keep existing essential choices and remote codecs. | Baseline plus directory evaluation. This does not solve long-note capacity. |
| 2 | Durable revisioned notes, source captures, scoped search/read and Markdown export/import. Capture-to-recall works after a conversation reset and host restart. | New local schema and compatibility design, all shipped-schema preservation fixtures. |
| 3 | Personal correction history and true forget cover retained evidence, derived views and pending work. | Stage 2. No shared team-memory dependency. |
| 4 | Derived profile/one-pager and task links fit a combined budget and report freshness. Cache and provider-switch behavior remain stable. | Stages 2/3 plus model-based quality and token evidence. |
| 5 | #1634: opt-in per-agent external session adapters with durable cursors, redaction, review and safe failure log. | Stages 2/3, source adapter fixtures and explicit laptop/VPS transfer design if required. |
| 6 | Periodic stale-claim review through existing routines and bounded background extraction. | Stages 3/5 plus cost, fairness, restart and cancellation evidence. |

Recommend stages 1 and 2 first. No replacement database or provider SDK is needed for the research
or the lexical baseline. The memory-tree issue and external-session issue remain open until their
own product behavior and verification exist. Open implementation questions are limited to reviewed
defaults and a measured extraction model; none justifies an automatic
data migration or remote memory upload in this research change.
