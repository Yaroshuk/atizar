# Step 6 — Re-point the board/thread UI to server state (drop `@copilotkit/*`)

**Status:** DESIGN (2026-06-10) · branch `feat/provider-contract-v2` (same-branch strategy, steps 1–6)
**Spec author:** session 2026-06-10 · supersedes nothing · build spec → `docs/pipeline-updated-3.md` §6
**Plan:** `docs/superpowers/plans/2026-06-10-server-driven-ui-step6.md`

## Goal

Make the **server the single source of truth** for the consumer UI. Today the React client is
*client-authoritative*: `useAgentInstances` spawns CopilotKit **proxied agents**, owns the
cap/queue, derives status from messages (`statusFrom`), builds the pipeline tree, and performs
cross-agent **handoff** entirely client-side (`deliver` → `spawn`). After step 6 the client only
**reads** server state (`GET /api/board` + SSE) and **acts** via plain HTTP (dispatch, deliver,
approve/reject, cancel). All `@copilotkit/*` packages and the `<CopilotKit>` tree are deleted.

This is the swap the steps 3–5 "coexistence" note promised: the new spine has driven lead-inbox
through the throwaway `?spike=1` surface; step 6 makes it the real board and retires the old path
**in one move** (no half-migration).

## What already exists (verified 2026-06-10)

The server spine (steps 3–5) already exposes **every read/act endpoint** the UI needs:

| Endpoint | Shape | Role |
|---|---|---|
| `GET /api/board` | `{items: WorkItem[], gates: Gate[], lastEventId}` | board snapshot |
| `GET /api/board/stream` | SSE `event: board`, `data: {kind:'refresh'\|'status'…}` | coarse board changes → refetch |
| `GET /api/workitems/:id/trace?from=seq` | `{id,status,done,nextSeq,events:[{seq,event}]}` | thread history |
| `GET /api/workitems/:id/stream` | SSE (`id:`=seq, `data:`=AG-UI event, `event: status`) | thread live tail (honors `Last-Event-ID`) |
| `GET /api/workitems/:id/gate` | `{id,toolName,form,formRev,proposedArtifact}` | open gate (approve/edit) |
| `POST /api/gates/:id/resolve` | `{formRev,decision,form?,comment?}` → `{ok}` / 409 / 502 | approve/reject + server-executed effect |
| `POST /api/workitems/:id/cancel` | `{ok}` | Stop a work item (+active descendants) |
| `POST /api/workflows/:id/cancel` | `{ok}` | Stop a whole workflow |

`foldEventsToMessages` (step 2, `@atizar/core`, unit-tested) + `pairToolResults` already turn a
trace into `Message[]`; the `?spike=1` page proves the attach → fold → live-tail → approve loop
without CopilotKit. Pure client logic that survives: `pipelineModel.buildPipeline`, `aggregate`,
`buckets`, `devMode`, `renderRegistry` + all cards, `threadResults`, the Smedja `styles.css`.

## Scope discovery — server-side handoff does NOT exist yet

The RunObserver (`consume()`) reacts to exactly two things: a registered render tool-call → fill
`card`; `GATE_OPENED` → insert a Gate + suspend. **It never dispatches a child work item.** Every
steps 3–5 verification drove a *single* agent via `/api/dev/runs` (`agent:'lead-inbox__reply'`
with a payload), bypassing the qualifier→reply chain. In the old model the qualifier→reply handoff
was a **client** `deliver()` → `spawn()`.

Crucially, **handoff is human-gated, not model-autonomous.** The model renders a card
(`renderVerdict`); the *human* clicks the card's "Draft reply" button, whose `Destination`
(`{kind:'agent', agentId:'reply'}`) is **hardcoded in the render spec**, not in the model's tool
args. (`renderVerdict` args carry only the lead data + `origin`.) GitHub-triage is the same: the
`TriageCard` route buttons call `deliver` with a hardcoded destination; "Treat as lead" calls
`deliver(origin, {kind:'contract', workflow:'lead-inbox', input:'lead'}, toLead(ticket))`.

So server-side handoff is **not** in-stream detection — it is a **REST endpoint hit by a card
button click**. The dispatch chokepoint already supports `parentId` + depth cap + dedup-by-`source`
+ `maxInstances`; the only gaps are (a) an endpoint and (b) destination resolution server-side.

## Design

### S1 — Lift `resolveDelivery` + `deliveryKey` into `@atizar/core` (pure)

`apps/inbox/client/src/deliver.ts` is pure and depends only on the workflow **descriptors**
(isomorphic) + `Destination`/`instanceId`/published `inputs` (already in core). Move
`resolveDelivery(descriptors, origin, dest, payload)` and `deliveryKey(payload)` to
`@atizar/core` (e.g. `packages/core/src/delivery.ts`). The client keeps importing them; the
server gains access. (Extraction discipline: pure helpers → core immediately — same pattern as
`gate.ts`/`fold.ts`/`conformance.ts`.) The client `deliver.ts` becomes a thin re-export or is
deleted with imports re-pointed.

`resolveDelivery` returns `{ok:true, instanceId, targetWorkflow?}` or `{ok:false, error}`. It
validates a cross-workflow payload against the published `input.schema`. Server and client run the
**same** validation.

### S2 — `POST /api/deliver` (the handoff endpoint)

```
POST /api/deliver  { origin: string, dest: Destination, payload: object, parentId: string }
  → 200 { id, deduped }   | 400 { error }  (bad contract / payload schema)
```

Handler: `resolveDelivery(descriptors, origin, dest, payload)` → on `ok`, split `instanceId`
(`wf__agent`) → `dispatch({ workflowId, agentId, origin:'agent', payload, source: deliveryKey(payload),
parentId })`. `parentId` = the work item whose card emitted the delivery (the open thread's id).
On `!ok` → 400 (a dev-time contract error; mirrors the old client `console.warn`). Dedup by
`source` is already in the chokepoint (a repeated click on the same source = `{deduped:true}`,
no second child). `origin:'agent'` marks a handoff-dispatched item (vs `'human'` START).

The `descriptors` registry is available server-side via `workflowServers[].descriptor`.

### S3 — Promote START to `POST /api/dispatch` (production trigger)

`/api/dev/runs` already mints + dispatches `{agent, payload?}` with `origin:'human'`. Rename to
`POST /api/dispatch` (production) and keep the body shape `{ agent: 'wf__agent', payload? }`. The
START button on an input agent card POSTs `{agent: instanceId(wf, agentId)}` (empty payload → the
input agent reads the inbox itself). Delete `/api/dev/runs` once the client no longer calls it.

### C1 — Data hooks (`@atizar/react` candidates; live in `client/src/` for step 6)

- `useBoard()` → fetch `GET /api/board`; subscribe `GET /api/board/stream`; on any board message
  **refetch the snapshot** (coarse model — the snapshot is the truth, the SSE is just a poke).
  Returns `{items, gates}` (server `WorkItem[]`/`Gate[]`). Last-Event-ID/reconnect = refetch.
- `useWorkItemThread(id)` → snapshot `trace?from=0`, then `EventSource(stream?from=nextSeq)`,
  order/dedupe by `seq`, `foldEventsToMessages` + `pairToolResults`. Returns
  `{messages, toolResults, status}`. (This is the spike's effect, productized.)
- `useGate(workItemId, status)` → when `status==='awaiting_approval'`, fetch
  `GET /api/workitems/:id/gate`; expose `{gate, approve(form), reject(comment)}` that POST
  `/api/gates/:id/resolve` with the gate's `formRev`. A 409 → refetch the gate and re-render
  (formRev moved).
- `useDispatch()` → `start(agentKey)` POST `/api/dispatch`; `deliver(origin,dest,payload,parentId)`
  POST `/api/deliver`; `cancel(id)` / `cancelWorkflow(id)`.

### C2 — Board → pipeline + agent grid (server-authoritative)

The board `items` carry `parentId`, `agentId` (= `wf__agent`), `workflowId`, `status`,
`resolution`, `card`. Map them to the existing pure models:

- **Status mapping** — extend `client/src/status.ts` to consume the **server** union
  (`queued|running|awaiting_approval|awaiting_input|result|finished|error|closed` + `resolution`)
  and reduce to the display `Status` (`idle|running|awaiting_approval|done|error`):
  `queued|running → running`; `awaiting_approval → awaiting_approval`;
  `finished|closed|result → done`; `error → error`; `rejected`/`cancelled` resolution markers
  surface as a sub-label but reduce to `done`. The server is now the source of truth — no more
  `statusFrom` over messages (DELETE it).
- **Pipeline tree** — `buildPipeline` takes `PInstance[]` with `parentLocalId`. Feed it from the
  active workflow's board items: `localId = item.id`, `parentLocalId = item.parentId`,
  `agentId = stripWf(item.agentId)`, `status = mapStatus(item)`, `isInput = role==='input'`,
  `label` from `item.payload`. `queued: N` per agent = count of `queued` board items for that
  agent (replaces the client `queuedByAgent`). `pipelineModel` is unchanged.
- **Agent grid** — per agent *type*, aggregate the statuses of its board items
  (`aggregate.ts` unchanged). START shows for `role:'input'` agents.

The board is filtered to the active workflow (`WorkflowSwitcher` unchanged). A finished/closed
item leaves the active board view but stays queryable (DoneDrawer is post-beta — for step 6 a
finished item simply drops out of the pipeline once it has no active descendants; the result card
remains reachable by opening the agent type, which the board still lists — match current behavior:
input agents + awaiting/error are kept visible).

### C3 — Thread view (replaces CopilotKit `renderToolCall`)

Keep `AgentModal`'s markup. Replace its CopilotKit-sourced `renderToolCall` prop with a **local**
function built from the workflow `renderSpecs`:

```
renderToolCall({toolCall, toolMessage}) =>
  spec = renderSpecs.find(s => s.toolName === toolCall.function.name)
  parameters = JSON.parse(toolCall.function.arguments)
  return spec.render({parameters}, deliverFn, renderRegistry)
```

`deliverFn = (origin,dest,payload) => deliver(origin,dest,payload, openWorkItemId)` (C1). The
`renderableToolNames`/dev-mode filtering, `ThreadResultsContext`, and intro/typing logic are
unchanged. `foldEventsToMessages(events)` feeds `agent.messages`.

### C4 — Approval (gate-driven, not HITL `respond`)

The old `HitlSpec` rendered `ApprovalDialog` with a CopilotKit `respond('approved')`. In the new
model **the gate is authoritative** (its `form`+`formRev`, not the stream args). When the open
thread's status is `awaiting_approval`, render the workflow's approval card from `useGate`:

- Change `HitlSpec.render` ctx from `{args, status, respond}` to
  `{form, formRev, status, approve, reject}` where `approve(editedForm)` / `reject(comment)` POST
  `/api/gates/:id/resolve` (via `useGate`). The card edits `form` locally and calls `approve(form)`.
- The `saveDraft` tool-call in the folded stream is **not** rendered as a card (it stays the
  hidden approval tool — its chip in dev mode shows "running", expected under HITL-kill). The
  approval UI is the gate-sourced card, rendered once per open gate.

This removes the per-instance HITL registration problem entirely: there is no shared `respond`
ref — each gate is a row keyed by `gateId`, resolved by an independent POST. Concurrent approvals
are naturally independent (no `executingToolCallIds` global).

### C5 — Handoff notes / cross-workflow badges (derived from board topology)

The old `handoffNotes`/`unread` were client deliver-time state. Now derive from the board:
- A work item with `parentId` in a **different workflow** than its parent ⇒ a cross-workflow
  delivery → raise the target workflow's badge (count active items whose `parentId` is in another
  workflow, not yet viewed). For step 6, a simple per-workflow "N new since last view" derived from
  board items is sufficient; the "Open in <wf>" jump uses `workflowId`.
- A parent→child link (same workflow) is shown by the pipeline tree itself (it already nests
  children under parents). The textual "→ Handed … / ← Received …" notes can be derived from
  `parentId` + child `payload` label, or dropped for beta (pipeline nesting already conveys it).
  **Decision:** keep them minimal — derive a "received" note from the item's own `parentId`
  (label from payload) and a "sent" note on the parent from its children; no separate client state.

### D — Deletions

DELETE (client): `App.tsx` CopilotKit wrapper (becomes a plain shell), `useAgentInstances.ts`,
`instancesCore.ts` (client copy — the cap/queue is server-side now; keep `instancesCore.test.ts`
only if the logic moved to core, else delete), `statusFrom.ts` (+test), `InstanceTools.tsx`,
`components/LiveInstanceModal.tsx`, `useWorkflowRenders.tsx`, `spike/TraceSpike.tsx`, the
`renderVerdict.test.tsx`/`renderLead.test.tsx` CopilotKit harness (rewrite to mount the card
directly). DELETE (server): the `createCopilotEndpoint`/`CopilotRuntime`/`InMemoryAgentRunner`
mount in `index.ts`, `buildAgent`'s CopilotKit coupling if any, `/api/dev/runs`. DELETE (deps,
FINAL commit): `@copilotkit/react-core`, `@copilotkit/runtime`. **KEEP `@ag-ui/client`** (the AG-UI
event vocabulary — `BaseEvent`, used by `foldEventsToMessages`, the trace, the providers).

KEEP: `renderRegistry` + all cards (LeadCard, VerdictCard, TriageCard, TicketResultCard,
ReplyDraftCard, ApprovalDialog), `RenderSpec`/`HitlSpec` contracts (HitlSpec ctx changes per C4),
`pipelineModel`/`aggregate`/`buckets`/`devMode`/`status` (extended), `threadResults`, `Icon`,
`WorkflowSwitcher`, `PipelineColumn`, `AgentCard`, `InstancePickerModal`, `styles.css`, `?dev=1`.

## Non-goals (post-beta / later steps)

`@atizar/react`/`@atizar/server` **extraction** is step 7 (step 6 keeps everything in
`apps/inbox/`, but new hooks/components obey the extraction import discipline: they import only
`@atizar/*` + each other). DoneDrawer, stale badge UI, ConnectionStatus indicator, batch
approve, notifications — post-beta. No new server status edges (the union is already complete).

## Risks / gotchas (carried from CLAUDE.md + this design)

- **Browser-only bug class.** Typecheck + unit tests pass with broken render/SSE wiring; the
  CLAUDE.md history is full of bugs only the browser caught (text-delta split, capture-once
  closures, agent-not-found, the SSE close-before-flush strand). Browser-verify EVERY flow.
- **SSE close ordering** — the routes already close only after the terminal status write flushes;
  the client must tolerate duplicate/out-of-order events (order by `seq`) and a board `refresh`
  that arrives before the snapshot reflects it (refetch is idempotent).
- **Stale dev stacks / ports** — kill root `.bin` stacks + free `:4000/:5173` before verifying
  (CLAUDE.md). `predev` already frees the LISTEN sockets + starts Postgres.
- **Cap test under replay** — the "3-at-once → 2 active + queued:1" check now tests the **server**
  WorkerPool; surfaced via board `queued` items. Replay (`DEV_RECORD_REPLAY=1`) is fine here (no
  shared-toolCallId issue — that was a CopilotKit artifact, now gone).
- **formRev 409** — editing then approving a gate whose rev moved must re-render, not silently
  fail (already 409 server-side; the client `useGate` must surface it).

## Definition of done

Typecheck/test/lint/format green; `@copilotkit/*` gone from `package.json` and the import graph;
and the **full browser E2E checklist** (memory rule — every flow) on the new path:
single run (START → qualify → card); handoff (Verdict "Draft reply" → reply child appears in the
pipeline under its parent → gate); approve **with an edited artifact** (verify the edited text
lands in the real Gmail draft); reject + explicit re-run; cancel mid-run; reload mid-run (re-attach,
nothing lost); 3-at-once (server cap 2 + `queued: 1`); cross-workflow "Treat as lead" (badge +
"Open in lead-inbox", background run); second-tab coherence (board SSE keeps both tabs in sync).
Mark step 6 ✅ BUILT in `HANDOFF.md` with an As-built note.
