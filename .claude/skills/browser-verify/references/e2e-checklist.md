# E2E checklist, surfaces, record/replay, and what only the browser catches

## Surfaces

- **`?dev=1`** (persisted to localStorage via `devMode.ts`) — reveals every raw tool-call chip.
  The consumer thread shows ONLY registered render/HITL cards by default; internal data-fetch
  tools (`list_my_tickets`, `get_latest_email`, `get_ticket`) are hidden unless dev mode is on.
  Use it to confirm a data tool ran and flipped Running→Done.
- **`?spike=1` (`&id=<workItemId>`)** — the pipeline dev trace surface: folds the trace/SSE
  endpoints into a thread, shows the gate + Approve. Reload re-attaches via the `id` in the URL.
  This is the harness for verifying the server-authoritative spine (steps 3–5) until step 6
  re-points the real board UI.

## record / replay (`DEV_RECORD_REPLAY`)

Cassettes are one JSONL per `wf__agent` under `apps/inbox/.cassettes/` (gitignored, **real
captured data** — never share without `scanCassette`; the `guard-cassette-share` hook backstops
this). Step key = resolved-approval count (→ store's resolved-gate count at step 5).

| Mode             | Behavior                         | When                                                     |
| ---------------- | -------------------------------- | -------------------------------------------------------- |
| `=1` / `=replay` | replay if recorded, else record  | default fast iteration                                   |
| `=record`        | force real `claude`, overwrite   | after a prompt change; **and to verify concurrent HITL** |
| unset            | pure production path, no wrapper | byte-identical prod check                                |

**True replay check:** a replay run leaves the cassette **mtime unchanged** and completes in
~seconds. If mtime moved or it took ~30s, it hit real `claude` — say so; don't call it a replay.

**Replay masks concurrent HITL.** Two instances replaying ONE cassette share its recorded
`toolCallId`; CopilotKit's global `executingToolCallIds` removes the id after the first approve, so
the second instance renders no-respond — a false "second button dead." Real `claude` mints a unique
id per run, so verify concurrent HITL with `=record`.

## The flow checklist (run EVERY flow the change touches)

One passing flow is not "done." Expected results:

1. **Single run** — start one item → runs to its expected end state (e.g. `awaiting_approval` with
   the proposed artifact, or `finished`).
2. **3-at-once** — route 3 in one burst → cap holds at **2 active + `queued: 1`**; the queue
   drains when a slot frees. (Cap is per-agent `maxInstances`, default 2; `triage`/`qualifier` =
   1.) The cap holds against a same-tick burst because `instRef` is the synchronous source of
   truth — a leak here shows as 3 active.
3. **Approve WITH an edited artifact** — edit the gate body, approve → DB gate `resolved` with the
   EDITED `form.body`; `action_ledger` one row `{ok:true, draftId}`; item `finished`; **fetch the
   draft by id from Gmail and confirm the edited text is what landed** (the load-bearing
   server-executed-effects guarantee). Thread shows the resume narration, NOT a `create_draft`
   call.
4. **Reject + re-run** — reject → `finished`/`rejected`, **zero** ledger rows; explicit re-run
   starts a fresh item.
5. **Cancel mid-run** — Stop while running → stream killed mid-flight, `finished`/`cancelled`,
   status not flipped back by the post-loop (terminal-tolerant). Cancel at `awaiting_approval` →
   gate `GET` → 404.
6. **Reload mid-run** — reload → re-attaches to the same live run, full history restored via
   `foldEventsToMessages`, nothing lost. After approve, reload shows the full STITCHED history
   (one trace, two provider runs).
7. **Second-tab coherence** — a second tab reflects the same board/thread state.
8. **stale formRev → 409** — resolving with a stale formRev returns 409, item not consumed.
9. **restart durability** — kill+restart the server mid-`awaiting_approval` → the gate SURVIVES
   (startup sweep leaves `awaiting_approval` durable); `running` → `error('executor lost')`,
   `queued` re-enqueued.

Run only the subset the change can affect — but for HITL/approval/lifecycle changes that subset is
usually most of the list. Enumerate them in Stage 0 and check each.

## What only the browser catches (scan in Stage 5)

These pass typecheck + unit tests while the app is broken:

- **Text split into multiple bubbles** (`"Draf"`/`"ted a reply"`) — contiguous text deltas must
  share ONE `messageId`. Should render as ONE bubble.
- **`Agent 'default' not found`** thrown at runtime — `<CopilotKit>` needs `agent={...}`; we
  register `qualifier`/`reply`, not `'default'`.
- **A render-tool callback silently no-ops** — `useRenderTool` freezes the callback on first
  registration; a state-dependent callback (e.g. the handoff trigger) frozen to its initial
  snapshot does nothing. The button should actually fire.
- **A tool chip stuck on "Running"** — should flip to Done via `TOOL_CALL_RESULT`. EXCEPTION: the
  `saveDraft` approval chip stays "running" under the HITL-kill model — that is EXPECTED (the
  approval tool never gets a `TOOL_CALL_RESULT`), not a failure.
- **The page reloads itself mid-run** — stale-stack / Vite ws-disconnect artifact (see
  `dev-servers.md`), NOT an app bug. Clean the environment; don't debug the app.
