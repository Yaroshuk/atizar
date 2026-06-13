# Spec — Week-0 spike: RunObserver + browser attach (beta build order step 2)

**Date:** 2026-06-10
**Branch:** `feat/provider-contract-v2` (step 1 + step 2 share this branch per the HANDOFF
continuation note — `master` lacks the v2 contract).
**Status:** design approved (Sergey, 2026-06-10), pre-implementation.

## 1. Purpose

The thread design in `pipeline-updated-3.md` (locked decision 6) drops the `@copilotkit/*`
transport and rebuilds the thread as **server-side Trace + a per-WorkItem SSE tail**. Before
committing to the Postgres spine (step 3), prove the two unproven client assumptions with
throwaway code:

- **(a) attach without CopilotKit** — a browser can attach to a server-side run mid-flight,
  see the history, and follow the live tail; a reload loses nothing.
- **(b) approve as a plain HTTP POST** — a human approval is an HTTP command, and the **same
  open SSE tail continues across the resume boundary** without reconnecting. One WorkItem =
  one Trace stitched from two provider runs (`run()` then `resume()`) is a load-bearing
  invariant of the thread design.

**If the spike fails, the design changes in week 0, not mid-migration.** Throwaway code is
allowed; the **endpoint READ shapes and the event-fold function must survive** into steps 3/6.

PASS criteria (from HANDOFF step 2):

1. Open the browser MID-run → see history + live tail.
2. Reload MID-run → nothing lost.
3. After approve (plain POST) → the already-open tail continues WITHOUT reconnecting.
4. Reload after approve → full **stitched** history (both provider runs).

Driven on the `lead-inbox__reply` cassette via `DEV_RECORD_REPLAY=1` (not live `claude`).

## 2. Scope boundary (HARD)

**In:** the fold function, the in-memory RunObserver, the two read endpoints, dev start +
resolve routes, a `?spike=1` dev page, and a minimal `withRecordReplay` extension to also
wrap `resume()`.

**Out (steps 3–4, NOT here):** `transition()`/guards, the Gate table, the action ledger,
`formRev`, server-executed effects, Postgres. **Approve resumes the run; it executes
nothing.** The in-memory "gate" is a single flag, not a record.

## 3. Components

### 3.1 `foldEventsToMessages(events) → Message[]` — DURABLE, `@atizar/core`

The reduction CopilotKit's runtime did internally. Pure & isomorphic (no React, no Node).
A **left fold**: `fold(events)` and `fold(events.slice(0,k))` agree on their common prefix,
so a viewer re-folds the whole Trace on every SSE delta without special-casing the tail.

Event → message mapping (exactly what `claude-stream` / the mock emit):

| Event | Effect |
|---|---|
| `TEXT_MESSAGE_CHUNK` | assistant bubble keyed by `messageId`; deltas concatenated |
| `TOOL_CALL_START` | assistant message keyed by `parentMessageId`, one tool call appended |
| `TOOL_CALL_ARGS` | appended to that call's `function.arguments` (routed by `toolCallId`) |
| `TOOL_CALL_END` | no-op (boundary marker only) |
| `TOOL_CALL_RESULT` | a `role:"tool"` message (paired later via existing `pairToolResults`) |
| anything else (e.g. `GATE_OPENED` CUSTOM) | skipped — not a message |

Order is preserved by a Map's insertion order (every message id is unique and first appears
at its stream position). The existing `pairToolResults` then pairs results to calls exactly as
`AgentModal` does today — the spike reuses that, not a parallel pairing.

This is the piece that survives: at step 6 the thread renders `fold(trace)` instead of
CopilotKit's `agent.messages`.

### 3.2 RunObserver + in-memory store — THROWAWAY, `apps/inbox/server/dev-runs.ts`

Per WorkItem:

```
WorkItemRun {
  id          // minted on start
  agentKey    // wf__agent, e.g. "lead-inbox__reply"
  status      // 'running' | 'awaiting_approval' | 'done' | 'error'
  trace       // TraceEntry[] = { seq, event }[]   (seq = index, monotonic)
  emitter     // EventEmitter: 'event' -> TraceEntry, 'status' -> status
  done        // true once the stitched run reaches a terminal status
  gate?       // GateOpenedValue captured at GATE_OPENED (the in-memory flag)
  input       // the RunAgentInput (turn 1) — reused to build the ResumeHandle
}
```

`consume(run, iterable)`: for each event → `seq = trace.length`, push `{seq,event}`,
`emitter.emit('event', …)`; on `readGateOpened(event)` → set `run.gate`, status
`awaiting_approval`. Loop on:

- **start (turn 1):** status `running` → `consume(provider.run(input))` → if no gate, status
  `done`. Fire-and-forget (NOT awaited) so the client can attach mid-run.
- **resolve:** status `running` → `consume(provider.resume(handle, resolution))` → status
  `done`. Appends to the **same** `trace` + `emitter`, so the open SSE keeps flowing.

`handle = { runId: run.id, input: run.input }`;
`resolution = { gateId: run.gate.toolCallId, decision, form }`.

The store is a `Map<id, WorkItemRun>` module-global. Throwaway: step 3 replaces it with
Postgres-backed Trace + the dispatch chokepoint.

### 3.3 Endpoints

Mounted on the existing Hono app in `server/index.ts` (dev server). READ shapes survive;
start/resolve are dev throwaway.

- **`GET /api/workitems/:id/trace?from=seq`** → JSON
  `{ id, status, done, nextSeq, events: [{seq,event}] }` (history from `seq`). **SURVIVES.**
- **`GET /api/workitems/:id/stream`** (SSE via `hono/streaming`) → replay backlog from
  `Last-Event-ID` (header) or `?from`, then tail live. Each trace event:
  `id: <seq>\ndata: <AG-UI event JSON>\n\n`; a named `event: status\ndata: <status>` on each
  status change. Closes when `done`. **SURVIVES.**
- **`POST /api/dev/runs { agent }`** → mint id, start turn 1, return `{ id }`. THROWAWAY
  (step 3 starts via the dispatch chokepoint).
- **`POST /api/dev/workitems/:id/resolve { decision, form? }`** → set the in-memory gate
  flag, run `provider.resume()` into the same trace. THROWAWAY (step 4 = gate-keyed
  `/api/gates/:id/resolve` with `transition()` + ledger).

### 3.4 `buildProvider` extraction — small DURABLE refactor

Extract `buildProvider(def, prompts, allowedTools, key) → Provider` from `build-agent.ts`
(the resolve + `withRecordReplay` wrap), and have `buildAgent` call it. The RunObserver gets
the raw wrapped `Provider` through the SAME path the CopilotKit agents use — including the
record/replay wrapper, with no duplicated wiring.

### 3.5 Client dev page — THROWAWAY, `?spike=1`

`main.tsx`/`App` checks `?spike=1`; if set, renders `<TraceSpike/>` instead of the app.
Minimal renderer (chosen over reusing `AgentModal`+cards — that path is what step 6 builds):

1. "Start reply run" → `POST /api/dev/runs {agent:'lead-inbox__reply'}` → `id`.
2. `GET …/trace?from=0` → seed `events` + `status` (fast JSON paint).
3. `EventSource …/stream?from=<nextSeq>` → append live events; update status on the `status`
   event.
4. Render `foldEventsToMessages(events)`: text bubbles; tool-call chips (running/done via
   `pairToolResults`); a gate banner showing `readGateOpened(...).proposedArtifact` with an
   **Approve** button when `status==='awaiting_approval'`.
5. Approve → `POST …/resolve {decision:'approved'}`; the open `EventSource` keeps delivering
   the resume events (no reconnect).

Reload path: re-fetch `trace?from=0` (full stitched history) then re-open SSE from `nextSeq`
→ nothing lost (PASS 2 & 4).

## 4. The one design fork — record/replay for `resume()` (DECIDED: Variant A)

`withRecordReplay` today wraps only `run()`. To keep the spike fully cassette-replayable AND
exercise the real v2 `resume()` contract:

**Add a `resume()` to the SAME decorator, with the SAME auto-semantics, in the SAME place
(`build-agent` via `buildProvider`)** — no separate logic. Per Sergey's two conditions:

1. **Same auto-semantics:** no events recorded under the key → call the real provider's
   `resume()`, pass events through, write them. A recorded key → replay. Identical to how
   `run()` already behaves; just a second method on the returned object.
2. **Cassette recorded after the step-1 branch:** the current `lead-inbox__reply.jsonl`
   (Jun 10) contains `GATE_OPENED` (step 0) and `step:1` (the resume output). Old cassettes
   lack `GATE_OPENED` and must not be used.

**Key:** resume step = `resolvedApprovalCount(handle.input.messages, approvalNames) + 1`. For
the spike's one gate: turn-1 input has empty messages → `0 + 1 = 1` → replays the existing
`step:1` events. (`run()` keying is untouched — additive.) Requires `withRecordReplay` to also
receive `approvalNames` (already does) and to expose `resume` only when the wrapped provider
has one (`resume?` is optional).

**Note on the existing step-1 events:** they were recorded by the legacy `run()`-with-resolved-
transcript path, but a cassette just yields recorded events regardless of how they were
produced, and `claude-cli.resume()` emits the same "draft saved" text — so replaying them under
the resume path is correct.

## 5. Files

**New:**
- `packages/core/src/fold.ts` + `fold.test.ts` (durable, TDD)
- `apps/inbox/server/dev-runs.ts` (RunObserver + store + route factory — throwaway)
- `apps/inbox/client/src/spike/TraceSpike.tsx` (+ minimal styles — throwaway)

**Edited:**
- `packages/core/src/index.ts` — export `fold`
- `apps/inbox/server/build-agent.ts` — extract `buildProvider`
- `apps/inbox/server/record-replay.ts` — wrap `resume()` (Variant A)
- `apps/inbox/server/index.ts` — mount dev routes
- `apps/inbox/client/src/main.tsx` (or `App.tsx`) — `?spike=1` branch

## 6. Verification

- `yarn typecheck`, `yarn test` (fold unit tests + the new resume-wrap test), `yarn lint`,
  `yarn format:check` — all green.
- **Browser E2E** on the `lead-inbox__reply` cassette (`DEV_RECORD_REPLAY=1`):
  1. Start a run, open `?spike=1` → history + tail visible (PASS 1).
  2. Reload mid-run → history intact (PASS 2).
  3. Approve → open tail continues, no reconnect, "draft saved" text appears (PASS 3).
  4. Reload after approve → full stitched history (PASS 4).
- Single dev server (kill stale stacks first per CLAUDE.md), one `:4000`, one `:5173`.

## 7. Non-goals / explicitly deferred

Postgres, `transition()`, guards, Gate table, ledger, formRev, server-executed effects, cancel,
startup sweep, board SSE, multi-WorkItem, auth/bearer token. The dev start/resolve routes and
the `?spike=1` page are throwaway. Timebox ~2 days; if `resume()` threatens it, ship attach-only
and note it (per HANDOFF).
