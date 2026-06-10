---
name: browser-verify
description: Drive the real app in a browser to verify a change actually works end-to-end before claiming it done. Use when about to say a fix/feature is done, ready-to-merge, or working; when running a browser E2E or verifying an HITL approval flow; when starting `yarn dev`; or when a dev server, a port (:4000/:5173), `EADDRINUSE`, a self-reloading page, or the Playwright-MCP browser misbehaves.
---

# Browser-verify

The procedure for proving a change works in the **running app**, not just in tests. This repo's
defining bug class is **"only the browser catches it"** — typecheck and unit tests pass while the
app is broken (text-bubble splits, frozen render closures, `Agent 'default' not found`, stuck tool
chips, self-reloading pages). Unit tests provably miss these. So a change is not "verified" until
it ran in a real browser and you watched it work.

**Core principle:** reserve the word **"verified"** for a flow that actually ran in the browser
in front of you. Tests passing, a server booting, or "no error" are NOT verification — say exactly
what you checked.

This is a **Procedure** (a building block — `../CONVENTIONS.md` Part 1), not a Task: it's invoked
as a step BY Task skills (a future `bug-fixing`, `add-workflow`, feature work) — or standalone for
a quick one-off ("verify this PR works"). It does **not** own the run and has **no
self-improvement stage**; the calling Task owns reflection and may amend this skill if a step here
falls short.

Follows [`../CONVENTIONS.md`](../CONVENTIONS.md). Self-contained — no external-plugin dependency.
Create one TodoWrite item per stage and work them in order.

## Stages

### Stage 0 — Preflight (what am I verifying)

- State in one sentence the change and the user-visible behavior it should produce.
- **Enumerate the flows the change touches** (Stage 4 has the canonical list) — a change rarely
  touches just one. HITL/approval changes especially: verify approve AND reject AND cancel.
- On a feature branch? Verify on the branch, not `master`. `git rev-parse --abbrev-ref HEAD`.
- Pick the surface: `?dev=1` (reveals raw tool-call chips; the consumer thread hides them by
  default) and/or `?spike=1` (the dev trace surface for the pipeline spine). See
  [`references/e2e-checklist.md`](references/e2e-checklist.md).

### Stage 1 — Clean the environment (the #1 recurring footgun)

Stale dev stacks are the single most common cause of "it reloaded itself / cassettes don't work /
HMR is dead." **Always clean first** — multiple sessions stack up (seen: 5 at once). Full command
set + why in [`references/dev-servers.md`](references/dev-servers.md). The short ladder:

1. `ps aux | grep -E "AiWorkflow/node_modules/.bin/(tsx|vite|concurrently)"` — see what's alive.
2. `pkill -9 -f "AiWorkflow/node_modules/.bin/(tsx|vite|concurrently)"` — kill stacks. **Note the
   trap:** `tsx watch` spawns a CHILD `node` whose command line is NOT `.bin/tsx`, so this pattern
   MISSES it and it keeps `:4000`.
3. `lsof -tiTCP:4000,:5173,:5174 | xargs kill -9` — free the ports (covers the tsx child).
4. If the Playwright-MCP browser errors **"Browser is already in use"** → recover the profile lock
   per [`references/playwright-recovery.md`](references/playwright-recovery.md) before driving.

### Stage 2 — Start ONE dev server in the intended mode

- Decide `DEV_RECORD_REPLAY`: `=1` (replay if recorded — fast, default for iteration); `=record`
  (force real `claude` — use after a prompt change, OR to verify concurrent HITL, since replay
  masks it; see [`references/e2e-checklist.md`](references/e2e-checklist.md)); unset (pure prod
  path). `predev` frees `:4000`/`:5173` before boot, but Stage 1 is still required for stragglers.
- `yarn dev` from the **repo root**. Confirm exactly ONE `server on http://localhost:4000` and ONE
  vite on `:5173`; `grep -c EADDRINUSE` the dev output must be `0`. If not, a stale server survived
  — back to Stage 1.

### Stage 3 — Drive the real browser

- Prefer the **live Playwright-MCP browser** (`browser_navigate`/`browser_snapshot`/
  `browser_click`/`browser_evaluate`) — see the real UI, real data, real testids. Navigate to the
  chosen surface (`http://localhost:5173/?dev=1`, or `?spike=1`).
- Click through the flow with your own eyes. Throwaway probe scripts are a last resort, not the
  default.

### Stage 4 — Run the flow checklist (the "every flow" rule)

Run EACH flow the change touches — one passing flow is not "done." Canonical set (full detail +
expected results in [`references/e2e-checklist.md`](references/e2e-checklist.md)):

- **Single run** — start one item → it runs to its expected end state.
- **3-at-once** — route 3 at once → cap holds: **2 active + `queued: 1`**, queue drains on a freed
  slot.
- **Approve WITH an edited artifact** — edit the gate body, approve → **verify the EDITED text is
  what lands in Gmail** (fetch the draft by id), DB gate `resolved`, one ledger row, item
  `finished`.
- **Reject + re-run** — reject → `finished`/`rejected`, zero ledger rows; explicit re-run works.
- **Cancel mid-run** — Stop mid-flight → stream killed, `cancelled`, status not flipped back.
- **Reload mid-run** — reload → re-attaches to the live run, full history restored, nothing lost.
- **Second-tab coherence** — a second tab reflects the same state.

### Stage 5 — Scan for "what only the browser catches"

Explicitly look for the invisible-to-tests symptoms (details in
[`references/e2e-checklist.md`](references/e2e-checklist.md)): text rendered as ONE bubble (not
`"Draf"/"ted a reply"` split); no `Agent 'default' not found`; render-tool callbacks fire (no
silent no-op from a frozen closure); tool chips flip Running→Done; the page does NOT reload itself
mid-run (that's the stale-stack artifact, not an app bug). Known-expected: the `saveDraft` chip
stays "running" under the HITL-kill model — that is correct, not a failure.

### Stage 6 — Report honestly

- Say which flows actually ran in the browser and their results. Reserve **"verified"** for those.
- If you ran under `=1` (replay), confirm it was **true replay** (cassette mtime unchanged) or say
  it hit real `claude`. Never call a replay-only run a verification of model behavior.
- If something is blocked (no account, a dep not deployed), say so plainly and what you'd need —
  don't fake-green and don't silently skip a flow.
- This Procedure ends at its report — no self-improvement stage. If a step here fell short, the
  calling Task's self-improvement amends it (`../CONVENTIONS.md` Part 1).

## Red flags — STOP, you're rationalizing

| Thought                                       | Reality                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| "Tests pass, so it works."                    | This codebase's worst bugs pass tests. Not verified until the browser showed it.                                   |
| "The server booted with no error."            | A stale server on `:4000` may be answering. Confirm ONE `:4000` + `0` EADDRINUSE.                                  |
| "It reloaded itself ~30s in — must be a bug." | Almost always stale stacks tripping Vite's ws-disconnect reload. Clean (Stage 1), don't debug the app.             |
| "Cassettes don't replay."                     | A stale non-replay server is intercepting. Stage 1 + confirm true replay (mtime unchanged).                        |
| "I'll just verify the one flow I changed."    | HITL changes break reject/cancel silently. Run every touched flow (Stage 4).                                       |
| "Second approve button is dead."              | Under `=1` two instances share the cassette's toolCallId — replay artifact. Verify concurrent HITL with `=record`. |

## Past-run incidents (verbatim — the skill learns in place)

- **"App reloads itself ~30s into a run."** Was NOT a feature bug — 5 stale dev stacks contended
  for `:5173`, starved the loaded tab's HMR WebSocket; on the CPU spike of a `claude` run Vite
  fired `vite:ws:disconnect → location.reload()` (a full React-state reset, NOT logged as
  `[vite] page reload`). Environment artifact. Stage 1 prevents it.
- **"Cassettes don't work" (record/replay).** A stale dev server held `:4000`; the fresh replay
  server hit `EADDRINUSE` (its `tsx watch` child isn't matched by the `.bin/tsx` pkill), and Vite
  kept proxying to the OLD server launched WITHOUT the env var → real `claude` every time. Fixed by
  `predev` freeing ports + Stage 1's `lsof :4000`.
- **Playwright "Browser is already in use … use --isolated" (2026-06-10).** A prior verify left a
  `mcp-chrome-*` process + `SingletonLock`; `browser_close` also fails (needs the same lock).
  Recover from a shell per `references/playwright-recovery.md`.
- **"Second concurrent approve button is dead" under replay.** Both instances replay the same
  cassette and share its recorded `toolu_…` id; CopilotKit's global `executingToolCallIds` removes
  the id after the first approve, so the second renders no-respond. A replay artifact — real
  `claude` mints a unique id. Verify concurrent HITL with `DEV_RECORD_REPLAY=record`.

## References

- [`references/dev-servers.md`](references/dev-servers.md) — kill stale stacks (exact pkill/lsof),
  the tsx-child trap, `predev`, EADDRINUSE diagnosis, the self-reload root cause.
- [`references/playwright-recovery.md`](references/playwright-recovery.md) — Playwright-MCP profile
  lock recovery.
- [`references/e2e-checklist.md`](references/e2e-checklist.md) — the full flow checklist, record-vs-
  replay semantics, `?dev=1`/`?spike=1` surfaces, the "only the browser catches it" catalog.
