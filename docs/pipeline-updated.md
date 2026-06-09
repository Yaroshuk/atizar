# Pipeline model — UPDATED (server-authoritative)

> **Status: SUPERSEDED by `docs/pipeline-updated-3.md`** (via `pipeline-updated-2.md` — read
> updated-3 instead). This document supersedes the runtime/ownership
> decisions in `docs/pipeline-model.md`. The *entity vocabulary* there (Source / WorkItem / Run /
> Gate / Case / Agent / Workflow, source-vs-payload, ownership-vs-lineage) stays valid and is
> assumed here. What changes is **where state lives, when a WorkItem is born, how the lifecycle is
> guarded, and how multi-user / multi-account works.** Derived from belief #1 ("the human conducts
> only what they can see") plus the conclusion of the architecture audit: orchestration must not
> live in the browser.

## Why this rewrite

The old model kept orchestration and durable state in the **browser** (`useAgentInstances`, React
memory). That made "durable" mean "survives until the tab reloads," broke multi-user (two managers
saw two diverging worlds), enforced the concurrency cap with a React ref, and forced us to fight
CopilotKit (per-instance HITL, proxied agents, captured-once render closures — the pile of "only
the browser catches it" gotchas). It also tied **WorkItem birth to a render-tool call**, so a run
that errored or rendered nothing silently produced no visible work.

The fix is one decision with many consequences: **the server owns the pipeline; the browser is a
view.**

## The shift in one line

> State, orchestration, and the lifecycle live in the **server** (in a database). The **browser is
> a window**: it shows the board and the open thread, and sends commands (start / approve / reject /
> edit-field). It holds no orchestration, no cap, no HITL promises, no lineage.

## Layers

```
CLIENT (window — view only)            SERVER (brain — owns everything)
─ board of active WorkItems            PipelineService  state machine, gates, lineage, auto-finish
─ open thread (CopilotKit renders      WorkerPool       bounded concurrency + queue
   ONE WorkItem)                       Provider(claude) spawn + kill-and-re-prime (server-triggered)
─ buttons → HTTP commands              StateStore       WorkItem/Gate/Override/credential-ref,
      │  command (HTTP)                                 everything scoped by accountId (SQLite/PG)
      ▼                                EventBus → SSE   push to every connected client of an account
      ▲  events (SSE stream)
```

**What moves from client to server:** instance orchestration (tree, cap/queue, teardown), WorkItem
& Gate as durable records, HITL pause/resume. **What CopilotKit / AG-UI becomes:** the transport
that renders the *one open thread* (stream text + cards) and sends approve/reject — nothing more, so
we stop abusing it for orchestration. **What stays as-is:** the `claude-cli` provider and the
kill-and-re-prime technique (now triggered by the server, not the browser); record/replay; the
`defineAgent` contract; the pure functions (`statusFrom`, `pipelineModel`, `aggregate`) move
server-side almost unchanged.

## Entities

```
WorkItem {
  id            // deterministic, assigned AT DISPATCH (not at render)
  accountId     // tenancy seam — on every row
  agentId       // owner (wf__agent); node is pinned, does not migrate
  source        // identity of the external thing (was deliveryKey): gh:#5 / Message-ID / board:8
  parentId?     // node it came from; null = human-started (case root)
  origin?       // thin label: parent / other-workflow / human
  status        // queued | running | awaiting_approval | awaiting_input
                //        | result | error | finished | closed
  result?       // card data — FILLED when a registered render tool fires (NOT a birth trigger)
  depth         // lineage depth — runaway backstop
  trace         // AG-UI events (audit, journal seed)
  createdAt, closedAt?
}

Gate {          // first-class sub-record of a WorkItem
  id, workItemId, accountId
  kind          // approval | choice | rate
  status        // open | resolved
  form          // decision data
  assignee?     // hook for the future hybrid model (null for now)
  resolvedBy?, resolvedAt?
}
```

The run envelope gains `workItemId`:

```
input = { workItemId, source, payload, origin }
```

`workItemId` lets a resume-after-approval run **continue the same WorkItem** (a new gate on it)
instead of being ambiguous with "a fresh independent run on the same source." It removes the old
"same agent + same source → new gate or new WorkItem?" guesswork.

## WorkItem birth = at dispatch (the core fix)

> A WorkItem is born when `PipelineService` **dispatches** a run, with a deterministic id assigned
> at that moment. The `result` field is **filled later** when a registered render tool fires. The
> render call is **no longer a birth trigger.**

A **dispatch** happens in exactly four cases:
1. a human clicks **start**;
2. a parent **routes** work onward (e.g. triage routes a row to the reply agent);
3. an agent calls a **handoff/spawn** tool (incl. a future chat agent minting a child mid-run);
4. work arrives via a **cross-workflow deliver**.

Consequences (this is the single change that dissolves audit findings #1 and #5):
- **Renders nothing / crashes mid-render** → the WorkItem still exists, is visible, and settles to
  `finished` (empty) or `error`. Work is never silently dropped. The human conducts what they see.
- **Deterministic identity** — the id is minted at an engine-controlled point, not on a
  non-deterministic model behavior.
- **Non-1:1 stays clean** — a triage run dispatches one WorkItem (the list); routing a row is a new
  dispatch → a child WorkItem. A chat run (1 run → 0..N) mints a child per spawn-tool call. The rule
  generalizes to every case.

Internal data-fetch tools (`get_latest_email`, `list_my_tickets`, …) are *tools inside a run*, not
dispatches — they never mint WorkItems, so the board stays clean.

## Lifecycle (server-side state machine, with guards)

```
[*] ── dispatch, pool full ──→ queued        queued ── slot freed ──→ running
[*] ── dispatch, slot free ──→ running

running ── approval tool, gate opened ──→ awaiting_approval
running ── chat needs free text ────────→ awaiting_input
running ── finalized + a render fired ──→ result
running ── finalized, no render, no kids → finished      (empty leaf)
running ── errored ─────────────────────→ error

awaiting_approval ── gate resolved=approve ──→ running          (re-prime)
awaiting_approval ── gate resolved=reject, no open gates ──→ finished
awaiting_input ──── reply received ──────────→ running          ← resume edge (was missing)

result ── [guard] ──→ finished
   guard = last gate resolved AND no open card actions AND all children finished/closed

error ── retry ──→ running        error ── drop ──→ finished
finished ── archive ──→ closed     finished ── reopen: a new active child appeared ──→ running
closed ── [*]
```

- `queued` is new — overflow waits in a **server** queue (the WorkerPool), not a React ref.
- The gate loop `running ↔ awaiting_approval` repeats across N gates; `finished` is reachable only
  when the guard holds (last gate + no open actions + children terminal).
- `awaiting_input → running` is the chat resume edge the old machine lacked.

**Result signal** (how to tell a real result from an empty finish), checked at finalize: errored →
`error`; stopped at an approval → `awaiting_approval`; called ≥1 registered render tool → `result`
(fills `result`); else → `finished`. "Called a card" is read from `defineAgent.renders` (no new
config). This only sets the `result` field — it does **not** gate birth.

## auto-finish / reopen = a store transaction

The race (a child finishing while a new child is being born) is killed by making both operations
**serialized transactions** on the store:
- a child going terminal calls `tryFinishParent(parentId)` inside a transaction that **re-checks the
  guard atomically** (all children terminal AND own card done);
- dispatching a new child under a parent runs in a transaction that, if the parent is `finished`,
  atomically flips it back to active (**reopen**).

SQLite (single-writer) and Postgres (row-lock on the parent) give this atomicity for free — the
lost-update the old in-memory model risked cannot happen. This is what XState's atomic `onDone`
gives, at the store level.

## Cycles: tree + dispatch guard + depth cap

AI↔AI (two agents conversing) is deferred, but the lineage invariants must stay provably finite:
- **Single-parent tree** (as today) + a **dispatch cycle-guard**: on dispatch, walk up the lineage;
  if the target `(agentId, source)` already appears among the ancestors, the dispatch is
  rejected/flagged. The tree never becomes a graph by accident.
- A **`depth` cap** (e.g. 20) as a runaway backstop (also the missing loop-control the audit flagged).
- When AI↔AI is really needed, you lift to a DAG **deliberately**, not by stumbling into an
  auto-finish deadlock.

## Case = per-workflow (Variant 2)

A **Case** is a per-workflow view (nodes with this item-`source` walked by `parent`, within one
box). Crossing a workflow boundary **mints a new source on the other side** — like forwarding an
email creates a new ticket in another system. Only a typed payload (through the receiver's published
`inputs`) and a **thin origin reference** (`{originWorkflow, originSource, originWorkItem}` — labels,
not live objects) cross. The cross-box thread is reconstructable **on demand** via those origin
links (a "from: …" arrow you click), not shown stitched-together by default. This resolves the
old doc's self-contradiction ("Case crosses boundaries" vs "a new source is born at the boundary")
in favor of the boundary rule.

## Dedup — two distinct safeguards (both included)

The word "dedup" hid two different things:

**A — should this work run again at all?** (decided BEFORE dispatch)
A re-dispatch over the same `source` is governed by an **explicit per-destination flag:**
`one-time` vs `repeatable`. **Default = one-time.** No more implicit-by-key magic; "re-analyze"
destinations are opt-in `repeatable`. `source` keeps its real jobs (grouping into a Case, freshness
/ re-fetch), but it no longer silently decides repeatability.

**B — an action with consequences must execute once even across a crash + retry.** (INSIDE a run)
A run can error *after* a side-effecting tool already fired (e.g. it created a Gmail draft) and then
be retried — re-running the same segment. `source` dedups *processing*, not the *action*. So
side-effecting tools (send email, create draft) carry an **action-idempotency key**; the system sees
"this action already happened" and does not repeat it. Without B, a mid-run crash + retry double-sends.

A and B are different levels: A is "run it or not?"; B is "this dangerous action is exactly-once even
under retry." Both are in scope.

## Execution

- **WorkerPool** bounds concurrent runs per account (replaces the React-ref cap); overflow → `queued`,
  auto-starts on a freed slot. This is the real load regulator (idle accounts are nearly free; only
  concurrent active runs cost).
- The **`claude-cli` provider** is unchanged: spawn the binary, map NDJSON → AG-UI, and pause HITL by
  **detecting the approval tool call and killing the process**. The difference: the kill and the
  later **re-prime are triggered by the server**, not by a browser holding a promise.
- Record/replay still wraps the provider (it already runs server-side).

## HITL = a server gate, not a client promise

- Hitting an approval tool → the server **opens a Gate record** and the WorkItem goes
  `awaiting_approval`; the claude process is killed (nothing hangs while we wait).
- A human clicks Approve → `POST /accounts/:a/gates/:id/resolve` → the server **re-primes** the run
  (fresh run, "human approved", same `workItemId`) → SSE pushes updates to every connected client.
- Any connected member can approve (unless a future `assignee` scopes it). This removes per-instance
  registration, shared-`toolCallId` artifacts, and the client-held two-request dance entirely.

## Real-time: SSE per account

The server pushes board/thread updates over **SSE**, scoped to the account. All connected members
see one shared, live board. Survives reload (state is server-side); multi-tab and multi-user are
coherent by construction.

## Tenancy

- **`accountId` on every state row, credential-ref, and override** from day one (the seam).
- **Beta:** exactly one account (the server runs one pipeline; everyone sees the same thing).
- **Deploy for a client:** one container = one account (own DB, own `.env`, own credentials —
  strongest isolation). **Your hosting later:** many accounts in one server — same code, a config
  switch, no schema change.
- A **Workflow is a code template**; an **Account instantiates** it with its own credentials +
  overrides. The same reply workflow under HR1 and HR2 = one definition, two accounts, different
  Gmail. Physical isolation of execution/credentials (per-account sandbox) is a later deploy option,
  not a model change.

## Config & light editing (no Mode 2 builder)

The visual pipeline builder (Mode 2) is **dropped**. What remains is **light field-level editing in
the consumer view**: a few leaf text fields (`prompt`, `name`, `description`) marked `editableBy`
manager, stored as **per-account overrides** layered over the code-defined base. Structure stays in
code (dev view); only declared leaf text fields are override-able, so the merge stays trivial. This
is the modest, safe slice of config-as-data — not a UI that can express arbitrary agents.

## Storage

- A **`StateStore` interface** (repository) backs WorkItem / Gate / Override / credential-ref, all
  `accountId`-scoped. Backend swaps by env (the `DATABASE_URL` precedent).
- **SQLite (file)** locally, **Postgres** in prod, via **Drizzle**. An in-memory impl for unit tests.
- Local dev: `yarn dev` is unchanged except state lives in `.dev.db` — survives tab reload AND
  `tsx watch` server restart. Maps onto the three run modes (§10 of `ARCHITECTURE.md`): `yarn dev`
  (SQLite, auth off) · `docker compose up` (Postgres, auth off, prod parity) · client server
  (Postgres, auth on).

## What this fixes

| Problem | Fixed by |
| --- | --- |
| Reload wipes everything | Server-authoritative state in a DB |
| Two managers see different worlds | Single server source + SSE to all |
| Worker result vanishes (P1) | WorkItem durable + born at dispatch |
| Idle agent shows "running" intro (P2) | No running node → static description; running intro gated on lifecycle |
| Used one-time button stays active (P3) | "already acted" = a child WorkItem exists for this source; explicit one-time flag |
| Cap held only by a React ref | Real server WorkerPool + queue |
| Pile of "only the browser catches it" bugs | Stop using CopilotKit as an orchestrator |
| WorkItem birth tied to a non-deterministic render | Birth at dispatch; render only fills `result` |
| State machine gaps / auto-finish race | Explicit guards + store transactions |
| Tree breaks on future AI↔AI | Dispatch cycle-guard + depth cap; deliberate DAG later |
| Doc contradiction (Case boundary) | Case = per-workflow + on-demand origin links |
| Implicit-by-key dedup vs re-analyze | Explicit one-time/repeatable flag (default one-time) + action idempotency |

## What stays / what's deferred

**Stays:** `defineAgent` contract, `claude-cli` provider + kill-and-re-prime, record/replay,
source-vs-payload, ownership-vs-lineage, pure functions (move server-side).

**Deferred (model is shaped to add later without breaking):** chat agents (`awaiting_input` loop is
already in the machine), AI↔AI (lift tree → DAG deliberately), per-account execution sandboxing,
a materialized Case object (only when case-level state like assignee/priority is needed), the
`assignee`-based hybrid multi-user model, type-matched cross-workflow discovery.

## Open items

- **Close policy** (`finished → closed`): auto-archive by age / on next run, or manual — TBD.
- **Observability / eval** (per-step latency, cost, a run inspector) — the one gap not yet on the
  roadmap; recommended to add, since non-deterministic agents can't be debugged by re-reading code.
- **Auth/RBAC** shape for "members of an account" — design the interface now, run as admin-stub.

## Market conventions referenced

Temporal (durable execution; workflow vs activity = WorkItem vs Run), BPMN/Camunda (human task as a
first-class state; the durable record is created at dispatch, result fills in later), XState
(`onDone`, no death cascade, atomic guarded transitions), Erlang/Akka actors (message-passing
envelope), Kafka (key vs value = source vs payload), Stripe (idempotency key = safeguard B),
OpenTelemetry (span ownership vs trace correlation), DDD bounded contexts + Anti-Corruption Layer
(workflow boundary), Git (acyclic lineage DAG).
