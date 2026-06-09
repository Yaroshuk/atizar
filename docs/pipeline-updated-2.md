# Pipeline model — UPDATED 2 (server-authoritative, corrected)

> **Status: SUPERSEDED by `docs/pipeline-updated-3.md`** (the LOCKED build spec, 2026-06-09 —
> read that instead; this file is kept for the corrections' rationale). This superseded
> `docs/pipeline-updated.md`, which
> superseded `docs/pipeline-model.md`. The **core decision is unchanged and validated**: the server
> owns the pipeline (state, orchestration, lifecycle) in a database; the browser is a window. What
> this revision changes is a set of **corrections** that came out of an objective architecture audit
> (four independent reviews cross-checked against Temporal, Camunda, XState, AWS Step Functions,
> LangGraph, the OpenAI Agents SDK, AutoGen, Stripe idempotency, the OTel GenAI conventions, and SSE
> scaling practice). Every change below carries its *why* and an explicit **build-now / defer** call.

## What this document is for

`pipeline-updated.md` was right about the big move but bundled three premature "engine" features
onto it, under-specified two correctness-critical mechanisms, and left observability off the map.
This revision keeps the validated spine, **scopes the first build to what fixes real present pain**,
and **bakes the irreversibility protection in from the start** (the product's belief #1 demands it).

---

## 1. The validated core (unchanged — keep)

These were correct in `pipeline-updated.md` and stay:

- **Server-authoritative state in a DB.** `StateStore` (repository) backs WorkItem / Gate, browser is
  a view. Kills reload-wipe, multi-user divergence, and the React-ref cap. *Precedent: Temporal /
  Camunda / Step Functions all keep orchestration server-side, UI is a view.*
- **WorkItem born at dispatch, not at render.** The durable id is minted at an engine-controlled
  point; the card data fills in later. Decouples identity from non-deterministic model behavior.
  *Precedent: Camunda creates the durable task record at the wait state; the result fills in later.*
- **HITL = a server Gate record + re-prime.** Approval opens a Gate, the WorkItem goes
  `awaiting_approval`, the `claude` process is killed; on resolve the server re-primes. No client-held
  promise, no per-instance registration, no shared-`toolCallId` artifacts.
- **WorkerPool + `queued`.** Real server-side concurrency control; overflow waits in a server queue.
- **Transactional auto-finish / reopen.** A child going terminal and a new child being dispatched are
  serialized store transactions (corrected in §3.6).
- **Case = per-workflow.** A workflow boundary mints a new `source`; only a typed payload + a thin
  origin reference cross; the cross-box thread is reconstructed on demand.
- **`claude-cli` provider + kill-and-re-prime, record/replay, `defineAgent`, source-vs-payload,
  ownership-vs-lineage, the pure functions** (move server-side).

**Honest framing (corrected):** this is **Camunda-style human-task persistence with a
*non-replayable, re-priming* worker** — i.e. a deliberately thin, single-process orchestrator. It is
**not** Temporal: Temporal's defining property is deterministic replay from an authoritative event
history, which a black-box `claude` subprocess cannot provide and this design does not claim. Cite
Camunda and Step Functions for the human-task shape; do not cite Temporal for replay.

---

## 2. The corrections, in one table

| # | Correction | Build-now / defer | Why |
| --- | --- | --- | --- |
| 3.1 | Resume from the **serialized transcript + the verbatim approved artifact**, not the string "human approved" | **Now** | Re-prime re-runs the agent *by design* on every gate; a fresh re-derive can produce a *different* artifact than the human approved → violates belief #1 |
| 3.2 | **Human can edit the artifact at the gate**; the edited value is what executes | **Now** | The real product gesture ("fix the draft, send"); trivial in the gate model; makes 3.1 load-bearing |
| 3.3 | **Idempotency = three layers**; thin action-ledger seam built now | **Now** (thin seam); defer the bulletproof-vs-external-crash chase | Re-prime = intentional re-run; the moment a `send`/`delete` lands, an unguarded re-run double-acts. Belief #1: protect irreversible actions *architecturally* |
| 3.4 | Fix the `result` **status-vs-field** name collision (field → `card`) | **Now** (doc-level) | Same token is a state and a data slot; confuses every reader/implementer |
| 3.5 | **One** concurrency regulator: WorkerPool with a global ceiling + per-agent quota; `maxInstances` is the per-agent quota *inside* the pool | **Now** (doc-level) | `pipeline-updated` had a per-account pool AND per-agent `maxInstances` with no precedence = two queues |
| 3.6 | Atomicity done right: explicit `SELECT … FOR UPDATE` on the parent + a **canonical lock order**; SQLite `BUSY` retry policy | **Now** (if you build transactional finish/reopen — and you do) | "Atomicity for free" is half-true; a child-only read doesn't lock the parent (double-finish), and an up-the-lineage lock walk can deadlock |
| 3.7 | SSE: monotonic **event id per account + refetch-on-reconnect**; HTTP/2 + `X-Accel-Buffering: no` at the edge | **Now** | Plain SSE silently drops events across any reconnect; the board goes stale until a coincidental repaint |
| 3.8 | **Approval timeout** edge in the state machine | **Now** | `awaiting_approval` had no `expire` exit; a forgotten gate pins the WorkItem and its lineage forever (Step Functions mandates a timeout) |
| 3.9 | `trace` in a **separate append-only table**, not a blob column on the hot board row; retention policy | **Now** (cheap) / retention later | A full AG-UI event stream inline on the board row bloats every list query and grows unbounded |
| 3.10 | **Observability:** emit OTel GenAI spans from the provider boundary; per-gate cost/latency as WorkItem fields | **Now** (spans) | A non-deterministic system "can't be debugged by re-reading code"; record/replay is a test fixture, not observability |
| — | `accountId` on every row | **Defer** to first co-location | Beta = 1 account; client deploy = one container = one account (isolation is free). Cheap to add later (one migration + scoping); paying the per-query/test tax now buys nothing |
| — | Cycle **ancestor-walk** guard | **Defer**; keep the **depth cap** | Guards AI↔AI, which is deferred; the data it needs (`parentId` lineage) already exists, so adding it later is a small pure function at the dispatch chokepoint |
| — | The **graph** (multi-parent / cycles) | **Defer**; lay only the cheap groundwork (§7) | "Hard to add later" = it changes termination/finish/Case *semantics*, not code volume — and those rules can't be written well until a real cyclic agent exists. The tree foundation is reused, not thrown away |

---

## 3. The corrections in detail

### 3.1 Resume = transcript + verbatim approved artifact (the central fix)

`pipeline-updated` said resume is "a fresh run, 'human approved'." That discards the agent's in-flight
reasoning. Because kill-and-re-prime re-runs the agent **on every gate by design** (not just on a rare
crash), a fresh re-derive can take a different path and produce a **different artifact than the one the
human saw and approved** — `claude` is non-deterministic. That silently breaks belief #1 ("the human
conducts only what they can see").

**Rule:** the resume run is primed with **(a)** the serialized prior-turn transcript (from `trace`)
and **(b)** the **exact approved artifact** carried verbatim, with the instruction to *execute that
artifact*, not regenerate it. "Resume" means *continue from a recorded point*, not *re-think from
scratch*. (Mechanically close to the OpenAI Agents SDK's `to_input_list()` resume; the cost is a
longer prime prompt, which is acceptable.)

This converts the gate from "an approval to re-derive against" into "an approval of a concrete artifact
that is then executed."

### 3.2 The human edits the artifact at the gate (first-class)

The real product gesture is: *the reply agent proposes a draft → the manager edits the text → clicks
Send.* This is **not** a graph/cycle — it is ordinary human HITL and the tree stays a tree.

- The Gate's `form` holds the proposed artifact and is **editable** by the human before resolve.
- On `approve`, the (possibly edited) artifact in the form is the authoritative payload that 3.1
  carries verbatim into the resume. The agent does **not** get to overwrite a human edit.
- A "please revise — make it shorter" instruction (agent re-works it) is the **`awaiting_input`**
  loop (§5): same agent, same WorkItem, a new gate — still a tree, still deferred-chat-shaped.

### 3.3 Idempotency = three layers (thin seam now)

"Dedup" hid several things. Separate them; build the cheap layers now, do not chase the impossible one.

1. **Approval gate on the action** — `send`/`delete` never fire without a human click. Already core.
2. **Gate idempotency** — a Gate is a record with a status; resolving a resolved Gate is a **no-op**;
   the UI disables the button after the first click. Kills the human double-click. Cheap.
3. **Action-idempotency seam** — a thin ledger on side-effecting tools, built **now** as a seam even
   though only `draft` exists today, because (a) re-prime is an *intentional* re-run, so an unguarded
   irreversible tool double-acts on the next resume/crash, and (b) belief #1 requires protecting
   irreversible actions *architecturally, even if the developer is sloppy*:
   - table `action_ledger(key PRIMARY KEY, workItemId, result, createdAt)`;
   - a wrapper at the **MCP tool-execution seam**: compute a **deterministic** key (from
     WorkItem/source/action), look it up → if present, skip and return the recorded result → else
     execute, then write the key + result;
   - side-effecting tools are **declared** in `defineAgent` (an `effects` list, sibling of
     `approvals`) so the wrapper is applied by construction and a tool author *cannot forget it*.

   **Do not** chase bulletproof exactly-once against the external API: "create draft in Gmail → crash
   in the millisecond before writing the key → retry → duplicate" is a window that **cannot be fully
   closed** because Gmail is outside your transaction (even Stripe can't). The thin seam narrows the
   window and dedups the overwhelming majority on a deterministic key; that is the right amount.

### 3.4 `result` status-vs-field collision

The lifecycle has a state named `result` AND the WorkItem has a field `result?`; the transition
`result → finished` then reads as "the field transitions to finished." **Rename the field
`result` → `card`** (the lifecycle state `result` stays). Field names: `card` = the data;
lifecycle state `result` = "run finalized with a card, awaiting the human."

### 3.5 One concurrency regulator

There is **one** queue and **one** regulator: the **WorkerPool**, with two limits layered on it:
- a **global ceiling** (max concurrent runs in the process) — the real load/SPOF boundary;
- a **per-agent quota** = `defineAgent.maxInstances` (e.g. `triage`/`qualifier` = 1 = singleton),
  enforced *inside* the pool, not as a separate queue.

`maxInstances` is **not** a second regulator — it is the per-agent cap the single pool honors. Overflow
on either limit waits in the one pool queue → `queued` → auto-starts on a freed slot. (No `accountId`
in the first build — the ceiling is per-process; see deferral.)

### 3.6 Atomicity done right

The transactional finish/reopen idea is correct; "for free" is not. Build it as:
- `tryFinishParent` and `dispatchChild` both take an explicit **`SELECT … FOR UPDATE` on the parent
  row** before re-checking the guard (a child-only read under `READ COMMITTED` does **not** lock the
  parent → two finishers both observe "all children terminal" and both flip it). On Postgres,
  alternatively `SERIALIZABLE` + retry on `40001`.
- A **canonical lock order** for any multi-row lock (e.g. always ancestor-before-descendant, or by
  ascending id) to prevent the lineage-walk lock-ordering **deadlock**.
- On SQLite (single writer), a stated **`SQLITE_BUSY` retry/backoff** policy for the second writer.
- Define the **reopen ↔ archive** mutual exclusion (a `finished → closed` sweep must not race a
  `finished → running` reopen and orphan a fresh child). Tie this to the close policy (open item).

### 3.7 SSE hardening

State survives reload because state is server-side — **not** because of SSE. SSE itself needs:
- a **monotonic event id per account** and, on reconnect, a **full board snapshot refetch** (cheapest
  correct fix — state is server-side, a snapshot is easy). Without it, any reconnect (laptop sleep,
  wifi blip, proxy idle-timeout) silently drops events.
- edge requirements made explicit: **HTTP/2** (the 6-connections-per-domain HTTP/1.1 limit bites the
  multi-tab case this design advertises) and `X-Accel-Buffering: no` + long read timeouts behind
  nginx/Cloudflare.

(The cross-process pub/sub bus is a **deferred** concern — needed only at 2+ server processes; see §6.)

### 3.8 Approval timeout

Add an `awaiting_approval → (timeout) → error|finished` edge. A gate opened and never resolved
otherwise pins the WorkItem and blocks its lineage's auto-finish indefinitely. The timeout value is a
per-gate/per-agent config; default policy TBD (open item), but the **edge exists** in the machine.

### 3.9 `trace` storage

`trace` is an **append-only log in its own table** keyed by `workItemId`, not an inline blob on the
WorkItem row (which would drag MBs through every board list query). Decide its role explicitly: it is
the **audit/observability log + the resume seed (3.1)**; the authoritative lifecycle is still the
`status` column (this is *not* event-sourcing — a deliberate, stated choice). Add a retention/
compaction policy (later).

### 3.10 Observability

Emit **OTel GenAI semantic-convention spans** from the `claude-cli` provider boundary (it is the
natural span source), and make **per-gate cost / latency / token usage first-class WorkItem fields**.
A non-deterministic system is undebuggable by re-reading code; this is the one gap `pipeline-updated`
left off the roadmap, and it is a pillar, not a footnote. Record/replay cassettes are a test fixture,
not observability.

---

## 4. Entities (revised)

```
WorkItem {
  id            // deterministic, assigned AT DISPATCH
  agentId       // owner (wf__agent); pinned, does not migrate
  source        // identity of the external thing (gh:#5 / Message-ID / board:8)
  parentId?     // single parent; null = human-started (case root)   ← single-parent = graph groundwork (§7)
  origin?       // thin label: parent / other-workflow / human
  status        // queued | running | awaiting_approval | awaiting_input
                //        | result | finished | error | closed
  card?         // RENAMED from `result`: card data, filled when a registered render tool fires
  depth         // lineage depth — runaway backstop (kept; ancestor-walk guard deferred)
  cost?, latencyMs?, tokens?   // observability (§3.10)
  createdAt, closedAt?
  // NOTE: no accountId in the first build (deferred to co-location)
}

Gate {          // first-class sub-record of a WorkItem
  id, workItemId
  kind          // approval | choice | rate
  status        // open | resolved
  form          // decision data — EDITABLE by the human before resolve (§3.2)
  resolvedBy?, resolvedAt?
  expiresAt?    // approval timeout (§3.8)
}

ActionLedger {  // §3.3 — idempotency seam for side-effecting tools
  key           // deterministic, derived from WorkItem/source/action
  workItemId, result, createdAt
}

Trace {         // §3.9 — append-only, own table, NOT a blob on WorkItem
  workItemId, seq, event, at
}
```

Run envelope (unchanged from `pipeline-updated`, with the resume note):

```
input = { workItemId, source, payload, origin,
          resume?: { transcript, approvedArtifact } }   // §3.1 — present on a re-prime
```

---

## 5. Lifecycle (revised state machine)

```
[*] ── dispatch, pool full ──→ queued        queued ── slot freed ──→ running
[*] ── dispatch, slot free ──→ running

running ── approval tool, gate opened ──→ awaiting_approval
running ── chat needs free text ────────→ awaiting_input
running ── finalized + a render fired ──→ result        (fills `card`)
running ── finalized, no render, no kids → finished      (empty leaf)
running ── errored ─────────────────────→ error

awaiting_approval ── resolved=approve ───→ running        (re-prime: transcript + approved artifact §3.1)
awaiting_approval ── resolved=reject, no open gates ─→ finished
awaiting_approval ── timeout ────────────→ error|finished   ← NEW (§3.8)
awaiting_input ──── reply received ──────→ running

result ── [guard] ──→ finished
   guard = last gate resolved AND no open card actions AND all children finished/closed (atomic §3.6)

error ── retry ──→ running        error ── drop ──→ finished
finished ── archive ──→ closed     finished ── reopen: new active child ──→ running   (excl. archive §3.6)
closed ── [*]
```

Notes: `result` here is the **state**; the data lives in `card`. `awaiting_input` and its resume edge
remain in the diagram as documented intent (chat deferred — no producer yet). The empty-finish path
should be refined so a run that did real work but rendered no card (e.g. crashed after `list_my_tickets`
but before `render_triage`) is not mislabeled a no-op (open refinement).

---

## 6. Scope — build now vs defer (and why deferral is safe)

**Build now (the slice that fixes every named present pain):**
StateStore + WorkItem/Gate as durable rows (SQLite; in-memory for tests) · birth-at-dispatch ·
server Gate HITL with **transcript+artifact resume (3.1)** and **human-editable gate form (3.2)** ·
the **idempotency seam (3.3)** · single WorkerPool regulator (3.5) · transactional finish/reopen done
right (3.6) · SSE with refetch-on-reconnect (3.7) · approval timeout (3.8) · one-time/repeatable flag ·
Case = per-workflow · `trace` table (3.9) · **OTel spans + per-gate metrics (3.10)** · `depth` cap.

**Defer — and why it's safe (all are "cheap to add later", data already present):**
- **`accountId` everywhere** — beta is one account; client deploy is one-container-one-account
  (isolation free). Adding later = a migration + scoping pass. Building now taxes every query/test for
  zero benefit and risks a *false* sense of isolation a single-account beta never tests.
- **Cycle ancestor-walk** — the `depth` cap is the runaway backstop now; the walk needs only the
  `parentId` lineage (already present) and is a small pure function at the dispatch chokepoint later.
- **Bulletproof exactly-once vs external crash** — impossible to perfect; the thin seam (3.3) is the
  right amount.
- **Cross-process pub/sub for SSE** — only needed at 2+ server processes. *What it is:* the in-process
  `EventBus` lives in one server's memory, so a second server's clients never hear its events; an
  out-of-process pub/sub (Redis / Postgres `LISTEN-NOTIFY` / NATS) is a shared broadcaster all
  processes subscribe to. Add when you actually run more than one process.
- **The graph** — see §7.

---

## 7. Tree now, graph later (cheap groundwork only)

The first build is a **single-parent tree**. The graph (multi-parent / cycles, for autonomous AI↔AI
loops) is **deferred**, because it is hard for an intrinsic reason, not a code-volume one: it changes
**termination, finish, and Case semantics** — "all children terminal → finish parent" stops holding
(multi-parent finish ambiguity, finish-deadlocks), Case-by-parent-walk loops, and `depth` stops being
a single number (loop control becomes mandatory). Those rules **cannot be written well until a real
cyclic agent exists** to define its own stopping condition; building them now means guessing blind and
rewriting later anyway, while taxing every tree flow with cyclic-case complexity for zero current use.

**What the product actually needs is tree-shaped** (edit-and-send = §3.2; revise-via-chat =
`awaiting_input`); the graph serves only autonomous agent loops, which may never be needed.

**Cheap groundwork (already free from the tree model — do only this):**
- keep lineage clean: a **single explicit `parentId`** per WorkItem;
- route **all dispatch through one chokepoint function** (so the cycle-guard / loop-control can be
  inserted in one place later);
- keep the `depth` cap.

Most of the build (StateStore, dispatch, gates, HITL, SSE, WorkerPool, lineage) is **reused** by a
future graph; only the finish/termination logic and the lineage walk change. So "tree first" is the
shared foundation, not throwaway work — and the genuinely-different 10% is built later, when its rules
are known.

---

## 8. Market conventions referenced (honestly)

Camunda/BPMN (human task as a first-class persisted wait state; durable record at dispatch, result
later — **the closest and most apt analogy**) · AWS Step Functions (`waitForTaskToken` human-approval
pattern + mandatory approval timeout) · XState (`onDone`, guarded transitions — *as a conceptual model;
the real atomicity is the DB transaction*) · Stripe (idempotency key — *narrow-the-window + dedup, not
magic; exactly-once vs an external API is unattainable*) · OpenTelemetry GenAI semconv (provider-
boundary spans, per-step cost/latency) · Erlang/Akka actors (self-contained message envelope) · Kafka
(key vs value = source vs payload — *partition/identity intuition only; Kafka is at-least-once*) · DDD
bounded contexts + ACL (workflow boundary mints a new source). **Not Temporal-for-replay** — this
design deliberately does not provide deterministic replay (see §1).

---

## 9. Open items

- **Empty-finish refinement** (§5): don't mislabel a run that did real work but rendered no card.
- **Close policy** (`finished → closed`): auto by age / on next run / manual — TBD; must define the
  reopen↔archive exclusion (§3.6) alongside it.
- **Approval timeout default** (§3.8): value + on-expire target (error vs finished).
- **Trace retention/compaction** (§3.9).
- **Auth/RBAC** for "members of an account": design the interface now, run as an admin-stub; ships with
  the `accountId` work when co-location arrives.
```
