# Dev record/replay provider — design

**Date:** 2026-06-08
**Status:** approved design, pre-plan
**Topic:** A development-mode layer that records real provider runs to disk once, then
replays them instantly — so workflow developers iterate without waiting on the real `claude`.

## Problem

Every dev iteration today hits the real `claude` CLI subprocess (~30s/run, plus stdio MCP
servers). Building or debugging a workflow's UI, pipeline, handoffs, or cards means running the
same agent over and over. The real AI is slow and the loop drags. We want fast, deterministic dev
iteration against realistic data, without re-asking the model every time, and without diverging
the dev path from the production path.

## Goal

A **record/replay** layer that wraps the real provider:

- **First run of a step** → goes to the real provider, streams normally, and **records** the
  event stream to a file on disk (one-time slow run).
- **Every run after** (same agent, same step) → **replays** from the file, instantly. Survives
  app restart, survives closing the tab. We only hit the real AI again if the file is missing or
  the developer deletes it.

This becomes the basis of a future **project skill** that teaches workflow developers the loop:
"turn recording on, run each scenario once, then iterate instantly; changed a prompt → delete the
file and re-record."

## Non-goals

- **Not** content-aware. We do not inspect the email/ticket text. The same agent step always
  replays the same recorded stream regardless of which email came in. (Distinguishing different
  inputs is exactly the thing you can't meaningfully mock — that needs the real AI.)
- **Not** a test framework. This is a dev-speed tool. (Recordings could later seed regression
  fixtures, but that is out of scope here.)
- **Not** an artificial "live streaming" simulator. Replay emits recorded events immediately;
  fake inter-chunk delays are deferred (YAGNI).
- **Not** committed by default. Recordings contain real email/ticket content → gitignored.

## How it works

### A decorator around the real provider — not a new provider

The layer is a `Provider → Provider` decorator, toggled by an env flag. **Agent definitions are
untouched** (`provider: 'claude-cli'` stays). The wrapping happens once, at agent-build time:

```
agent passport (provider: 'claude-cli')
        │
  registry.resolve('claude-cli')  → real provider
        │
  DEV_RECORD_REPLAY set ?  withRecordReplay(realProvider, {...})  :  realProvider
```

- Works for **any** provider (claude-cli today, Mastra tomorrow) and **all** agents at once.
- The production path is the **same code** without the wrapper → zero dev/prod divergence.

Wiring point: `apps/inbox/server/build-agent.ts`. After constructing `provider`, if the env flag
is set, wrap it. `buildAgent` gains the agent's **instance id** (`wf__agent`) as a parameter (it
is already computed in `server/index.ts` at registration — we just pass it through) so the
decorator can key recordings per workflow×agent.

### Cassette identity — `wf__agent` + step

A recording is keyed by:

1. **`wf__agent`** (the runtime instance id). The same agent in two workflows
   (`lead-inbox__reply` vs `triage__reply`) is two independent agents → two independent files.
   Dynamic client-side instances (`wf__reply#1`, `#2`) all map to the one server agent `wf__reply`
   → they **collapse to one key** (correct: same agent type, same action; a recording made by
   instance #1 is served to instance #2).

2. **step** = the number of human approvals already resolved in the run input
   (`resolvedApprovalCount`, a new pure helper beside `approvalResolved`). HITL splits one logical
   run into multiple provider requests (claude-cli kills the process at each approval; resume is a
   fresh stateless re-prime). Each request is a "step":
   - step 0 → first run (no approval answered yet)
   - step 1 → after the 1st approval
   - step 2 → after the 2nd approval, etc.

   Number of recorded steps = 1 + number of approvals on the path. A simple agent = 2 steps; a
   multi-approval agent = N+1 steps; an agent with no approval = 1 step. **We count approvals; we
   never look at message content.**

### Storage — Variant A: one file per agent, steps inside

One JSONL file per `wf__agent`, holding **all** of that agent's steps. Each line is one recorded
AG-UI event tagged with its step:

```
apps/inbox/.cassettes/lead-inbox__reply.jsonl
```
```jsonl
{"step":0,"event":{"type":"TEXT_MESSAGE_CHUNK","role":"assistant","delta":"Drafting…"}}
{"step":0,"event":{"type":"TOOL_CALL_START","toolCallName":"saveDraft", ...}}
{"step":0,"event":{"type":"TOOL_CALL_ARGS","delta":"{...}"}}
{"step":0,"event":{"type":"TOOL_CALL_END", ...}}
{"step":1,"event":{"type":"TEXT_MESSAGE_CHUNK","role":"assistant","delta":"Draft saved to Gmail."}}
```

- **Few files** — one per agent; the agent's whole recorded path is in one place; deleting that
  file re-records the whole agent.
- **JSONL, not a JSON array** — appends a step's events without rewriting the file, gives readable
  git diffs, and mirrors the line-delimited stream-json the `claude` CLI already emits (which
  `claude-stream.ts` already parses line-by-line).
- Recording is appended a **whole step at a time** (each step is a separate provider request that
  finishes/gets killed before the next), so we never need mid-stream buffering.

### Per-step decision (not all-or-nothing)

On each run the decorator computes `step = resolvedApprovalCount(input)` and asks: *do I have this
step recorded for this agent?*

- **Yes** → emit the recorded events for that step. Do **not** call the real provider.
- **No** → call the real provider, **pass each event through** to the client unchanged, and
  **append** each as `{step, event}` to the file as it streams.

This means the first time an agent reaches step 1 (after the human approves), step 0 is replayed
but step 1 is recorded live — the file fills in incrementally across the natural HITL flow.

### Mode toggle

- `DEV_RECORD_REPLAY=1` (or `=replay`) — **auto**: replay a step if recorded, else record it.
  This is the normal dev mode.
- `DEV_RECORD_REPLAY=record` — **force record**: always hit the real provider and overwrite. Used
  to refresh after prompt changes. (Equivalent shortcut: just delete the agent's `.jsonl` file.)
- unset — wrapper not applied; pure real provider (production path).

## Safety & stability

- **PII / secrets:** recordings contain real email and ticket text. `apps/inbox/.cassettes/` is
  added to `.gitignore`; nothing is auto-committed. A curated, hand-scrubbed fixtures set could be
  committed separately later (out of scope now).
- **Sharing a cassette → mandatory agent safety scan (hard rule).** A recording is real captured
  data — it can contain personal emails, names, addresses, ticket text, and possibly tokens or
  secrets that leaked into a tool result. So **whenever the user asks to commit, push, share, or
  hand off a cassette** (or remove it from `.gitignore`), the agent MUST NOT just do it. The agent
  MUST:
  1. **Warn explicitly** that recordings hold real captured data and must be reviewed before they
     leave the machine.
  2. **Scan the cassette files itself** and **highlight every problematic spot** — email
     addresses, personal names, postal/physical addresses, phone numbers, and anything that looks
     like a credential/token/secret/API key — reported with `file:line` + the offending snippet so
     the user can see exactly what would be exposed.
  3. **Wait for the user to confirm** (or scrub) before proceeding. If the scan finds nothing, say
     so plainly; if it finds hits, the user decides.
  This is an agent-behavior rule, so it is also recorded in `CLAUDE.md` (don't-rediscover gotchas)
  and baked into the future skill — it must survive across sessions, not live only in a person's
  memory. The scan is a heuristic safety net (regex/keyword pass over the JSONL), **not** a
  guarantee — the warning makes clear the human is the final reviewer.
- **Determinism:** replay emits exactly the recorded event sequence — fully reproducible.
- **Stale recordings (optional, light):** when a prompt in code changes, the recording is stale.
  *Optional* nicety: store the prompt's hash on the step's first line and `console.warn` on
  mismatch ("cassette stale — delete to re-record"); never fail. May be deferred — the manual rule
  ("changed a prompt → delete the file") is the baseline.
- **No prod risk:** the wrapper is only constructed when the env flag is set; the unwrapped path is
  byte-identical to today's.

## Components

| Unit | Where | Purpose | Pure? |
|------|-------|---------|-------|
| `resolvedApprovalCount(messages, approvalNames)` | `@atizar/core` (messages.ts) | count resolved approvals → the step index | pure, isomorphic |
| event (de)serialization + step tagging | server (record-replay.ts) | `{step, event}` line encode/decode | pure |
| cassette store | server (record-replay.ts) | read step events / append step events to a `.jsonl` file under `.cassettes/` | node fs |
| `withRecordReplay(provider, {key, approvalNames, dir, mode})` | server (record-replay.ts) | the `Provider → Provider` decorator | node (composes the above) |
| wiring | `build-agent.ts` + `index.ts` | thread `wf__agent` id in; wrap when env flag set | node |
| `scanCassette(text)` → `{file, line, kind, snippet}[]` | server (record-replay.ts) | regex/keyword pass flagging emails, names, addresses, phones, token/secret-looking strings — backs the mandatory share-safety scan so it's deterministic + unit-testable | pure |

Node-only pieces live in `apps/inbox/server/` for now (same staging as the deferred
`@atizar/server` extraction); the pure step-count helper lives in `@atizar/core` beside
`approvalResolved`. Promote to a package when the server layer is extracted.

## Data flow

```
client run → CopilotKit → provider.run(input)
                                │
                   withRecordReplay decorator
                                │
            step = resolvedApprovalCount(input)
                ┌───────────────┴───────────────┐
         recorded?                          not recorded?
            │                                   │
   read step events from file          real provider.run(input)
            │                                   │
   yield events  ───────────────►  yield events (pass-through)
                                            +append {step,event} to file
```

## Testing

- **Pure:** `resolvedApprovalCount` — 0 approvals, 1 resolved, 2 resolved, unmatched ids
  (mirrors the existing `approvalResolved` tests).
- **Pure:** line encode/decode round-trip; step filtering.
- **Pure:** `scanCassette` — flags an email/name/token-looking string with `file:line`; clean
  input → empty; no false-positive on plain prose.
- **Decorator (with a fake provider + in-memory/temp fs):**
  - miss → calls real provider, passes events through, writes the step's lines;
  - hit → replays recorded events, does **not** call the real provider;
  - per-step: step 0 hit + step 1 miss in one file → replays 0, records 1;
  - `mode=record` → overwrites even when present.
- **Browser E2E:** record a real lead-inbox run once (slow), then re-run → instant, identical
  cards, HITL approve still works end-to-end (step 1 replays "draft saved"). Per project rule,
  drive the full browser pipeline.

## Documentation & skill deliverables (agentic-first — part of this work, not "later")

This is an agentic-first framework: a feature isn't done until it's written down where the next
agent (and the next developer) will find it. The implementation plan MUST include these doc
deliverables, written against the working code:

1. **`docs/ARCHITECTURE.md`** — add the record/replay layer to the architecture, marked
   `DESIGN INTENT` now and flipped to `BUILT` when it lands.
2. **`docs/BUILD-LOG.md`** — a new numbered section narrating what was built (the decorator, the
   key scheme, the JSONL store, the share-safety scan), per the existing per-feature convention.
3. **`CLAUDE.md`** — two stable rules under the relevant sections: (a) the don't-rediscover gotcha
   for how the dev loop works (`DEV_RECORD_REPLAY`, where cassettes live, delete-to-refresh,
   `.gitignore`); (b) the **hard share-safety rule** (agent must warn + scan + highlight before any
   cassette leaves the machine — see Safety above).
4. **`HANDOFF.md`** — status update on merge.
5. **A dedicated feature doc / skill content** — the developer-facing "what it is + how it works +
   the dev loop": enable `DEV_RECORD_REPLAY`, run each scenario once to record, iterate instantly
   against cassettes, delete a file (or `=record`) to refresh after a prompt change, never commit
   `.cassettes/`, and — when sharing — let the agent run its safety scan first. This is the seed of
   the future **workflow-developer skill**; write it so it can be lifted into a skill with minimal
   edits.

The skill itself (packaging the above as an invocable `.claude/skills/` entry) can follow as its
own step, but the prose it needs is authored here as part of the feature.

## Deferred / open

- Committed scrubbed fixtures for shareable demos.
- Stale-recording prompt-hash warning (may land in v1 if cheap).
- Artificial streaming delays for realistic feel.
- Promotion of the node pieces into `@atizar/server` when that extraction happens.
