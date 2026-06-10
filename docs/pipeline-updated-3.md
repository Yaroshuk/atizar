# Pipeline model — UPDATED 3 (decisions locked, build spec for the first public beta)

> **Status: LOCKED build spec.** Supersedes `pipeline-updated-2.md` (which superseded
> `pipeline-updated.md` / `pipeline-model.md` — the entity vocabulary there stays valid).
> Incorporates the 2026-06-09 50-agent architecture audit (Notion: "Анализ архитектуры v3 —
> стресс-тест 50 субагентами") and Sergey's decisions on it. The server-authoritative spine of
> updated-2 is **validated and unchanged**; this revision locks the open decisions and folds in
> the confirmed audit corrections.

## 0. Locked decisions (2026-06-09; #7 added 2026-06-10)

1. **Server-executed effects.** The model proposes artifacts and opens gates; the **server**
   executes approved side-effecting actions. Belief #1 becomes code, not prompt text.
2. **Stop/cancel is first-class** — per agent instance AND per whole workflow.
3. **Mastra + Postgres ship in the first public beta.** `claude-cli` is the **dev-only**
   provider (this also satisfies the philosophy's "no terminal-spawn in production" verbatim).
4. **Machine dispatch allowed; machine action never.** An inbound item may mint a visible,
   gated WorkItem; no machine-initiated irreversible action, ever. (Philosophy clarified.)
5. **Approval expiry never auto-resolves.** `expiresAt` + a visible "stale" badge; no default
   timeout, no machine deciding for the human. Manual exit = reject or cancel.
6. **Thread = Trace render + per-WorkItem SSE tail.** Drop the `@copilotkit/*` transport
   (runtime endpoint, `runAgent`, `useHumanInTheLoop`, proxied agents). KEEP: AG-UI as the
   event vocabulary, the render registry, cards/design, AgentModal's folding logic (ported to
   fold Trace events). Named fallback renderer: assistant-ui (ExternalStoreRuntime + AG-UI
   adapter).
7. **The beta IS the framework packages + a thin demo app.** The deliverable is the monorepo of
   libraries — `@platform/core|providers|integrations` plus `@platform/server` (pipeline engine)
   and `@platform/react` (board/thread UI) extracted as the LAST build step — and a small demo
   app with the basic workflows that consumes ONLY the public packages (the living proof of
   belief #3: userland never imports internals). NOT a clone-template app with incidental
   libraries. Extraction still happens once, at the end (after the API stops churning in steps
   3–6), with strict import discipline before that so the move is mechanical.

## 1. Changes vs updated-2

### 1.1 Server-executed effects (replaces the §3.3 dedup-only wrapper)

- `defineAgent` gains **`effects`** (sibling of `approvals`). Effect tools are **never in the
  model's allow-list**. The approval tool is a pure "ask"; the consequence is a separate tool
  only the server may invoke.
- On gate approve, the server constructs the effect invocation **from the Gate form** (the
  approved/edited artifact IS the tool arguments, byte-verbatim), executes it through the
  integration, and writes the `action_ledger` row **in the same transaction**.
- **Ledger key = `workItemId + gateId (+ attempt)`** — one resolved gate licenses exactly one
  execution; a retry of the same gate dedups; a new gate (revision) gets a new key by
  construction. "Already executed" returns an explicitly marked prior result, never a silent
  success.
- The resume run is primed with "the action was executed with <artifact>" — narrative
  continuation only; the model never re-performs or re-types the effect.
- Validation: `approvals ∩ effects = ∅` enforced in `defineAgent`.
- **Default-deny at the execution seam:** an undeclared tool is presumed side-effecting — it
  gets the ledger wrapper and (configurably) a gate until explicitly declared `readonly`.
  Forgetting a declaration fails safe, not silent.

This closes the audit's one critical finding (effect reachable pre-gate) and three importants
(model re-types the artifact; revise-loop false dedup; ledger seam living in a foreign OS
process — the server is now the executor, so the seam is local).

### 1.2 State machine completeness

- **Cancel edges** from `queued` / `running` / `awaiting_approval` / `awaiting_input` →
  `finished` with `resolution: cancelled` (honest audit trail: who/when). Commands:
  `POST /workitems/:id/cancel` and a workflow-level cancel (cancels every active WorkItem of
  that workflow's case/tree, in canonical lock order). Reuses the existing HITL kill path.
- **Startup reconciliation sweep:** on boot, every `running` row without a live executor →
  `error` ("executor lost", retryable via the existing retry edge); every `queued` row re-fed
  to the pool in `createdAt` order. Without this, the advertised "survives `tsx watch`
  restart" produces zombie running-forever cards.
- **`finished` entry guard is an invariant of the state**, checked in the same transaction on
  EVERY inbound edge (result/reject/timeout/drop/archive), not a property of one edge.
  Reject/timeout with live children: default policy = cascade cancel (uses the cancel edge).
  `finished → closed` re-checks children too.
- **Reject does not poison the source:** the one-time/"already acted" check counts only
  children that executed an effect (ledger entry) or finished approved. A rejected WorkItem
  carries a `rejected` outcome marker + optional reject comment, and offers an explicit
  re-run affordance.
- **Budget edge:** `budgetExceeded → error` + a per-agent cost ceiling in `defineAgent`.

### 1.3 Gate record (revised)

```
Gate {
  id, workItemId
  kind            // approval | choice | rate
  capabilities    // declared per-gate in defineAgent: can_edit / can_respond / can_ignore
                  // (Agent Inbox precedent; not every artifact may be editable)
  status          // open | resolved
  form            // decision data — editable per capabilities
  formRev         // int/hash; resolve MUST carry the rev the approver rendered; mismatch → 409
  proposedArtifact // the agent's original proposal — kept ALONGSIDE the edited form (audit)
  comment?        // reject/feedback comment (seed for the future revise loop)
  assignee?       // restored from v2 (one nullable column; first multi-user primitive)
  resolvedBy?, resolvedAt?
  expiresAt?      // expiry = visible stale badge; NEVER auto-resolve (locked decision 5)
}
```

The approval card renders the **source content** (e.g. the original email) next to the
artifact — the human can spot prompt-injection-shaped manipulation (the gate is the
mitigation only if the UI shows what the input was).

### 1.4 Provider contract v2 — BEFORE any PipelineService code

- `run(input) → AsyncIterable<BaseEvent>` unchanged.
- New **optional `resume?(handle, resolution)`** capability: `claude-cli` implements it as
  kill-and-re-prime (transcript + verbatim artifact); **Mastra implements it as native resume
  by `runId`** against its own snapshot store. The orchestrator never hard-codes re-prime
  mechanics.
- A **provider-agnostic `GATE_OPENED` signal** in the AG-UI mapping: `claude-cli` synthesizes
  it from approval-tool-call detection; Mastra derives it from its suspend status. Gate
  detection moves out of "spot a tool call in the stream" into the contract.
- A **conformance suite** runs against `claude-cli`, the mock, and Mastra — belief #2's
  two-unlike-providers proof ships with the beta.
- **StateStore boundary (belief #2):** WorkItem/Gate/Trace only (the consumer surface) plus a
  `workItemId ↔ runId` mapping. Engine step-state belongs to the provider (Mastra snapshots).
  The moment StateStore stores workflow-step state we are duplicating Mastra.
- Record/replay is re-keyed: cassette step = the store's gate-resolution count (old
  `resolvedApprovalCount(input)` message-scan dies with the envelope change; existing
  cassettes are wiped — they're gitignored fixtures).

### 1.5 RunObserver (the unnamed component, now named)

A server-side consumer of `provider.run()` that runs for **every** dispatch, browser or not:
appends Trace rows; reacts to `GATE_OPENED` (opens the Gate record, transitions to
`awaiting_approval`, kills/suspends via the provider); reacts to a registered render tool
(fills `card`, state `result`); finalizes status; republishes live events on a per-WorkItem
channel for any attached viewer. **Week-0 spike:** browser attach to a running WorkItem —
trace snapshot from `seq` + SSE tail. If the spike fails, the design changes in week 0, not
mid-migration.

### 1.6 Client / transport

- Board SSE: coarse WorkItem/Gate state changes only — never token deltas. The snapshot
  endpoint returns `{ items, gates, lastEventId }`; the subscription resumes from exactly that
  id (native `Last-Event-ID`). Reconnect = snapshot refetch (unchanged from §3.7).
- Thread: `GET /workitems/:id/trace?from=seq` returns history, then tails live events.
  Cursor = `Trace.seq` (per-WorkItem).
- Approve / reject / edit / cancel are plain HTTP commands against Gate/WorkItem — in live
  AND reopened threads (one approval path). `useHumanInTheLoop` is not replaced; it is
  simply unnecessary.
- What survives of the old client: render registry, all cards, Smedja design, the board
  layout, AgentModal's message-folding (ported to fold Trace events). What is deleted:
  `useAgentInstances`, `instancesCore`, `statusFrom`, proxied agents, per-instance HITL —
  replaced by the authoritative status column and server orchestration.

### 1.7 Storage: Postgres-first

- **Postgres is THE beta backend** — in dev too; one concurrency model instead of three.
  **Dev topology (do not get this wrong): Docker runs ONLY Postgres** (`docker compose up -d
  postgres`, or a host install via `brew install postgresql` — the server doesn't care). The
  **app itself stays on the host** (`yarn dev` exactly as today) because the `claude-cli`
  provider spawns the local `claude` binary authenticated via the macOS keychain — a
  containerized server process cannot reach either, so the dev server is NEVER put in Docker.
  A full app-in-Docker compose tier only becomes possible with a containerizable provider
  (Mastra / claude-api) and is the prod-parity story, not the dev loop. (A zero-docker demo
  path, if kept, uses the same SQL via embedded PG or is mock-only — SQLite is not a
  correctness tier anymore.)
- §3.6 rewritten for PG: `SELECT … FOR UPDATE` on the parent inside `transition()`;
  canonical lock order = **ascending WorkItem id** (matches the leaf→root auto-finish walk);
  alternative SERIALIZABLE + retry on `40001`. CI runs the race tests (concurrent
  double-finish, finish-vs-dispatch, reopen-vs-archive) against real Postgres.
- **drizzle-kit migrations + a `schema_version` row from the first durable row** — client
  deploys are long-lived databases; unversioned schemas in the field are the classic trap.
- **Trace:** append-only table, per-WorkItem monotonic `seq`, **lossless** (ALL tool
  calls/results recorded with a `surfaced` flag — surfacing is a UI filter, not a recording
  filter), AG-UI schema version stamped per row, and a specified AG-UI → prime-prompt
  serialization. It is the audit log, the resume seed, and the thread source.
- Two API hygiene items ship with the spine: a shared **bearer token** on all mutation
  endpoints (honest `resolvedBy`), and a secrets rule — tool results are scanned so tokens
  never land in `trace` / `action_ledger.result`.

### 1.8 Dispatch & triggers

All dispatch goes through **one chokepoint function** (unchanged §7 groundwork). The `origin`
enum reserves an `inbound` machine value now; **no trigger code ships in the beta**. The
philosophy is clarified rather than violated: machine **dispatch** (visible on the board,
gated, never acting by itself) is a legitimate origin; machine **action** is forbidden,
always.

## 2. Beta scope (locked)

**In:** hero vertical end-to-end on server state (lead-inbox: read → qualify card → draft →
human edits at the gate → approve → server creates the Gmail draft); zero-credential demo as
the default first run (`git clone && docker compose up` → live board on the mock provider +
synthetic cassettes; real Gmail = the documented one-hour step 2); the server spine of §1
(Postgres, StateStore, chokepoint, transition(), WorkerPool, board SSE, RunObserver);
server Gate HITL with the editable form; server-executed effects; cancel + sweep + guards;
**Mastra provider as the production path beside claude-cli (dev)**; cost/latency/tokens
fields on the card; packaging (README with the 10-minute demo, LICENSE, `@platform/*` rename,
scanCassette CI gate, golden-set eval harness per workflow).

**Out (safe deferrals, seams in place):** OTel span export (fields stay); auto-timeout
sweeper (column + edge stay); accountId/auth/RBAC beyond the bearer token; chat
`awaiting_input` producer; graph/cycles (depth cap + chokepoint stay); cross-process pub/sub;
GitHub-triage in the onboarding critical path (stays as a second "bring your own board"
example). Note (decision #7): package extraction (`@platform/server` + `@platform/react`) is
IN the beta as step 7; whether the packages also go to npm at launch or ship via the monorepo
first is a launch-time call — the package BOUNDARY (demo consumes only public packages) is the
non-negotiable deliverable, the registry is logistics.

**Three public embarrassments (non-negotiable):** (1) HITL integrity failure — an effect
firing before approval or sent text ≠ approved text; (2) zombie/stale state after a restart
or reload; (3) clone-and-nothing-works without the author's credentials.

**Explicitly acceptable beta failures:** a forgotten gate sitting open for days (Stop +
stale badge exist); O(N²) re-prime cost at 3+ gates on the claude-cli dev path (measure,
keep examples ≤2 gates, document the curve); a duplicate Gmail draft in the sub-millisecond
crash window (drafts are reversible; even Stripe can't close it).

## 3. Build order

1. **Provider contract v2** (`resume?` + `GATE_OPENED`) + conformance suite in
   `@platform/core` — before any PipelineService code.
2. **Week-0 spike:** RunObserver + browser attach to a running WorkItem (trace snapshot +
   SSE tail).
3. **Server spine on Postgres:** StateStore (drizzle-kit + schema_version), dispatch
   chokepoint, `transition()` API with guards, WorkerPool, board SSE.
4. **Server-executed effects + Stop** (cancel edges, sweep, finished guards, Gate fields:
   formRev / assignee / comment / both artifact versions).
5. **Mastra provider** (production path) beside claude-cli (dev); re-key record/replay.
6. **Re-point the UI** (board + thread from server state); delete `@copilotkit/*` deps.
7. **Extraction + packaging (decision #7):** move `server/pipeline/` → `@platform/server`
   and the board/thread UI → `@platform/react` (mechanical if the import discipline held);
   slim the demo app to workflows/config consuming ONLY public packages — the belief-#3
   proof; then zero-cred demo (synthetic cassettes + scanCassette CI gate), README, LICENSE,
   `@platform/*` rename, golden-set eval, bearer token.

## 4. Market references (delta vs updated-2)

Agent Inbox HumanInterrupt (per-gate capability flags); OpenAI Agents SDK (per-run
"always approve this tool" — log each auto-resolution as a resolved Gate; a later nicety);
Trigger.dev waitpoint tokens (signed gate-resolve link → email/Slack approval later, no auth
system needed); Zendesk solved-vs-closed (close policy: auto-archive `finished → closed`
after a configurable window; reopening a **closed** item forks a NEW WorkItem linked by
origin — sidesteps the reopen↔archive race for closed items); DBOS Transact (MIT, in-process
library) is the **named plan B** if scope ever creeps toward retries-with-backoff / cron /
multi-process workers.
