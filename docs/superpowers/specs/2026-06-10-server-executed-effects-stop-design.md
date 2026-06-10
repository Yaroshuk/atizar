# Server-executed effects + Stop — design (beta build order step 4)

**Status:** approved 2026-06-10. Branch: continue on `feat/provider-contract-v2` (steps 1–3 live
there, unmerged — same branch strategy). Supersedes the older "`approvals ∩ effects = ∅`" phrasing
in `pipeline-updated-3.md` §1.1 and `HANDOFF.md` (the effect-binding model corrects it to
`effects ⊆ approvals`).

## Goal

Make belief #1 ("the server executes side effects, the model only proposes") code, not prompt text,
and make Stop/cancel first-class. After this step:

- The model never sees the effect tool. It calls the **approval** tool (`saveDraft`) with the
  proposed artifact; on approve the **server** executes the effect (`createDraft`) from the gate
  form — the approved/edited artifact IS the effect arguments, byte-verbatim.
- One resolved gate licenses exactly one execution (`action_ledger`, key = `workItemId:gateId`).
- Optimistic concurrency on the gate form (`formRev`; resolve carries the rendered rev; mismatch
  → 409).
- Stop works per WorkItem and per workflow, across `queued | running | awaiting_approval`.
- Reject does not poison the source — it carries a `rejected` marker and offers an explicit re-run.
- A startup sweep already exists (step 3); this step adds cancel awareness to the inbound guard.

## Non-goals (deferred — decided 2026-06-10)

- **Gate capabilities** (`can_edit | can_respond | can_ignore`) → post-beta. Editability derives
  from `kind` for now (`approval` = editable; `choice`/`rate` = not). The `capabilities` column is
  a later additive migration.
- **Runtime default-deny at the execution seam** (an undeclared tool presumed side-effecting, gated
  at call time) → post-beta AND physically impossible under claude-cli (the CLI executes MCP tools
  itself; the server only sees the call detect-after-emit). Becomes meaningful at the Mastra/server
  seam (step 5+).
- **Budget edge / per-agent cost ceiling** (`pipeline-updated-3.md` §1.2 last bullet) → post-beta.

What this step DOES take from default-deny: the ~20-line enforceable kernel — **boot-time tool
classification** (below).

## Component changes

### 1. Contract — `defineAgent` + `ServerBinding` + boot checks

`@platform/core` `defineAgent` gains two optional string-array fields:

- `effects: string[]` (default `[]`) — which **approval** tools trigger a server-executed effect.
  Validation (zod `superRefine`): `effects ⊆ approvals`. (NOT the older `approvals ∩ effects = ∅`:
  in the binding model the model never sees an effect tool at all, so there is no disjoint
  model-visible effect set — an effect is keyed by the approval it backs.)
- `readonly: string[]` (default `[]`) — read-only tools (e.g. `get_latest_email`), declared so the
  boot classification (below) is exhaustive.

`ServerBinding` (in `apps/inbox/workflows/<wf>/server.ts`) gains:

```ts
effects: {
  [approvalToolName: string]: (
    form: Record<string, unknown>,
    ctx: { workItemId: string; gateId: string }
  ) => Promise<Record<string, unknown>>  // returns executedResult (→ ledger + trace)
}
```

Keyed by the **approval tool name** (`saveDraft`), the function is the Node effect:
`{ saveDraft: (form) => createDraft(form) }`. Functions live in the server layer (Node-only),
names live in core (pure data) — the same split as `renders` (names in core, components in the
client registry).

`buildAgent` enforces two invariants **at boot** (fail-fast, the existing pattern):

1. **Effect exhaustiveness, both ways:** `keys(ServerBinding.effects)` ≡ `defineAgent.effects`.
   A missing binding or an extra binding → startup error (never a silent approve-time no-op).
2. **Allow-list classification:** every tool in `ServerBinding.allowedTools`, reduced to its bare
   name (strip `mcp__<srv>__`), MUST be in `readonly ∪ approvals ∪ keys(renders)`. An unclassified
   tool → the server refuses to start. This is the README claim a public auditor will test ("add a
   mutating MCP tool undeclared → the framework won't boot", not "silently ran it ungated").

Concrete deltas:

- `reply`: `effects: ['saveDraft']`, `readonly: []`; `ServerBinding.allowedTools` loses
  `mcp__gmail__create_draft` → `['mcp__inbox__renderLead', 'mcp__inbox__saveDraft']`;
  `ServerBinding.effects = { saveDraft: (form, ctx) => createDraft(form) }`.
- `qualifier`: `readonly: ['get_latest_email']` (so `mcp__gmail__get_latest_email` classifies).

### 2. `createDraft` extraction

Today the draft-creation logic is embedded in the MCP tool handler `create_draft` in
`packages/integrations/src/gmail-basic/index.mjs`. Extract it into a plain exported async function:

```ts
createDraft({ threadId, body }) → { ok: true, draftId } | { error }
```

The MCP wrapper calls the same function; the server imports it directly (no MCP child for the
server path). `googleapis` stays a lazy-loaded optional peer (unchanged). The function derives
To/Subject from the thread metadata and never sends — draft only (product law).

### 3. Gate-resolve route — formRev → ledger → execute → resume

New `POST /api/gates/:id/resolve`, body `{ formRev, decision, form?, comment? }`. Replaces the
dev throwaway `POST /api/dev/workitems/:id/resolve`. Flows through
`PipelineService.resolveGate(gateId, resolution)`:

**decision = approved:**

1. **tx①** — `SELECT … FOR UPDATE` the gate. If `gate.formRev !== body.formRev` → **409** (the
   client re-renders the form). Else: mark the gate `resolved` (`form` = the submitted edit,
   `resolvedBy` from the bearer identity when present, `resolvedAt`); `INSERT action_ledger` claim
   (key `workItemId:gateId`). If the claim already exists → "already executed": return the prior
   `result`, do NOT execute again (explicitly marked, never a silent success).
2. **execute** — call `ServerBinding.effects[gate.toolName](gate.form, { workItemId, gateId })`
   (the real `createDraft`). Outside the DB transaction (external I/O), but under the claim taken
   in tx①.
3. **tx②** — write `action_ledger.result = executedResult`; append a trace entry recording the
   execution.
4. `transition(resume)` + `provider.resume(handle, { ...resolution, executedResult })`, prompt =
   "the action was executed by the server with <artifact>" — narrative continuation only.

**decision = rejected:** mark the gate `resolved` + `WorkItem.resolution = 'rejected'` + store the
comment; `transition(reject)`; `provider.resume` takes the rejected branch (no effect). The item
shows a `RejectedState` with an explicit re-run.

`GateResolution` (core) gains `executedResult?: Record<string, unknown>`.

The `?spike=1` page now resolves by **gate id**. Add a small read endpoint
`GET /api/workitems/:id/gate` → the open gate `{ id, form, formRev, proposedArtifact, toolName }`
so the client knows the id + rev to submit.

### 4. `transition.ts` — cancel/reject edges + full inbound guard

- New edge `cancel`: `from: ['queued','running','awaiting_approval','awaiting_input'] → finished`,
  and sets `resolution: 'cancelled'`.
- New edge `reject`: `from: ['awaiting_approval'] → finished`, sets `resolution: 'rejected'`.
  (Modeled as its own edge for a clean guard table, not a property of `finish`.)
- **The finished-entry guard (no active children) moves to one place applied to ALL terminal
  inbound edges** (`finish`, `cancel`, `reject`), not just `finish`. An item with active children
  does not finish; the last child's terminal edge triggers the parent walk.

### 5. Stop — per-workitem + per-workflow

RunObserver keeps an in-memory `Map<workItemId, AsyncIterator<BaseEvent>>` (drive the provider
stream via an explicit iterator instead of `for await`, so it can be interrupted).

`POST /api/workitems/:id/cancel`:

- `queued` → `transition(cancel)` + remove from the WorkerPool queue.
- `awaiting_approval` → the executor process is already dead (claude-cli HITL kill) →
  `transition(cancel)` + close the open gate.
- `running` → `transition(cancel)` **first** (so the consume loop's post-loop logic sees a terminal
  status and exits without overriding it — any `IllegalTransition` from the trailing `finish` is
  swallowed), THEN `iterator.return()` → the provider generator's `finally` runs `child.kill()`.
- **Cascade** to active descendants in ascending-id order (the existing lock order).

`POST /api/workflows/:id/cancel` — loop the above over every active WorkItem of that `workflowId`.

`consume()` becomes terminal-tolerant: before `transition(finish)` it re-checks the item is not
already terminal (cancelled), and if so exits without a transition.

### 6. `reply.prompts.ts` — propose-don't-execute

- `handoffFirst`: unchanged in spirit (the model calls `renderLead` + `saveDraft({threadId, body})`
  as a proposal). The "do not create the draft" instruction is now literally enforced — the model
  has no `create_draft` tool.
- `resume`: rewritten from "create the draft via create_draft" to "the server already created the
  draft (draftId from `executedResult`); confirm in one short sentence". `buildResume` reads
  `executedResult` instead of calling a tool.

## Data flow (approve, happy path)

```
model → saveDraft({threadId, body})           (approval tool call)
RunObserver: GATE_OPENED → insert Gate(form=proposedArtifact, formRev=0) → transition(gate)
             → process dies (HITL kill) → release slot
human edits body, POST /api/gates/:id/resolve { formRev:0, decision:approved, form:{threadId,body'} }
  tx①: formRev ok → gate resolved(form=body') + ledger claim (workItemId:gateId)
  execute: createDraft({threadId, body'}) → { draftId }      ← EDITED text lands in Gmail
  tx②: ledger.result = { draftId } + trace entry
  transition(resume) → provider.resume(handle, {executedResult:{draftId}})
  model: "Draft saved." → stream ends → transition(finish) → finished
```

## Testing

- **Unit (vitest, `aiworkflow_test` DB, no truncate in `beforeEach`):** `defineAgent` `effects ⊆
  approvals`; `buildAgent` boot checks (missing/extra effect binding; unclassified allow-list tool);
  `createDraft` extraction (mock googleapis); resolve route — formRev 409, ledger one-execution
  (double-resolve returns prior result, no second `createDraft`); `transition` cancel/reject edges +
  inbound guard with active children; cancel cascade order.
- **Race tests (real Postgres):** double-resolve of one gate (only one ledger row, one execution);
  cancel-vs-finish.
- **Browser E2E (every flow — memory rule):** record fresh (`DEV_RECORD_REPLAY=record`) then replay.
  1. single run → gate → **approve with an EDITED body** → the EDITED text is the Gmail draft
     (the load-bearing new guarantee: the server executes the edit, not the model);
  2. reject + explicit re-run;
  3. cancel mid-run (`running`);
  4. cancel `awaiting_approval`;
  5. restart mid-`awaiting_approval` → gate survives → approve still executes;
  6. stale formRev → 409 → form re-renders.
  Draft-only — no real outbound mail.

## Verification gate (step done)

Typecheck + test + lint + format green; all browser E2E flows above pass; HANDOFF step-4 line
flipped to ✅ BUILT with an As-built note; `pipeline-updated-3.md` §1.1 + the stale HANDOFF line
reconciled to `effects ⊆ approvals`.
