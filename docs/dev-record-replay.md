# Dev record/replay — developer guide

> **This page is the seed of the future workflow-developer skill.** The prose here is
> intended to be lifted into a `.claude/skills/` entry with minimal edits once the skill
> packaging lands.

## What it is

Every dev iteration against a real workflow today hits the actual `claude` CLI subprocess —
roughly 30 seconds per run, plus three stdio MCP server startups. Debugging a new card
layout, tweaking a handoff, or adjusting pipeline behaviour means running the same agent
over and over. The real AI is slow and the loop drags.

The **record/replay layer** records each real provider run to disk the first time, then
replays it instantly from that recording on every subsequent run. The first pass through
each scenario is slow (it talks to real `claude`). Every pass after is instant — the app
restarts, the browser tab closes, it does not matter; the recording survives. You only
hit the real AI again if you deliberately delete the file or flip the env flag.

This makes the dev loop fast and fully deterministic. You iterate against a fixed, realistic
event stream that behaves exactly like the real model's output — same cards, same HITL pauses,
same approval flow.

## How to use

**Normal record-and-replay (recommended):**

```
DEV_RECORD_REPLAY=1 yarn dev
```

`=replay` is an alias for `=1` — both select the same auto (replay-or-record) mode.

The first run of each agent scenario calls the real `claude` (slow, ~30s) and writes a
recording. Every run after replays instantly from disk. The recording fills in
incrementally: run the qualifier once to record step 0, click approve to record step 1 —
each step is saved the moment it completes, so the file is ready for the next run even
if you stop mid-flow.

**Force a fresh recording (after a prompt change):**

```
DEV_RECORD_REPLAY=record yarn dev
```

This mode always calls the real provider and overwrites whatever was on disk. Use it
whenever you change a prompt and want the recording to reflect the new behaviour.

An equivalent shortcut: delete the agent's `.jsonl` file under
`apps/inbox/.cassettes/`. The auto mode will re-record on the next run.

**Pure production path (unset flag):**

```
yarn dev
```

When `DEV_RECORD_REPLAY` is not set, the wrapper is not applied. The provider path is
byte-identical to what ships in production — no wrapping, no extra indirection, no
difference in behaviour.

## How it works

The layer is a `Provider → Provider` decorator, `withRecordReplay`, defined in
`apps/inbox/server/record-replay.ts`. The real provider is wrapped in
`apps/inbox/server/build-agent.ts` **only when `DEV_RECORD_REPLAY` is set**; the
production path is entirely untouched.

```
agent passport (provider: 'claude-cli')
        │
  registry.resolve('claude-cli')  → real provider
        │
  DEV_RECORD_REPLAY set?  withRecordReplay(realProvider, {…})  :  realProvider
```

This design means the decorator works for any provider (`claude-cli` today, Mastra or
`claude-api` tomorrow) and applies to every registered agent at once, without touching
any agent definition.

**Cassette identity — `wf__agent` + step.**
A recording is keyed by two things:

1. `wf__agent` — the runtime instance id (e.g. `lead-inbox__reply`). The same agent id
   in two workflows produces two independent files. Dynamic client-side instances
   (`wf__agent#1`, `#2`) all map to the single server key — a recording made by instance
   #1 is correctly served to instance #2, because they are the same agent type running
   the same step.

2. **step** — the number of human approvals already resolved in the run input
   (`resolvedApprovalCount` in `@atizar/core`). Because the `claude-cli` provider kills
   the process at each approval and resumes with a fresh stateless re-prime, one logical
   agent run is split into multiple provider requests. The step index tracks where in the
   approval sequence this request sits: step 0 = the first run (no approvals answered
   yet), step 1 = after the first approval, and so on. A simple two-step agent (one
   approval) produces two recorded steps; an agent with no approval produces one.

**Storage — one JSONL file per agent, all steps inside.**
Recordings live under `apps/inbox/.cassettes/`, one file per `wf__agent`:

```
apps/inbox/.cassettes/lead-inbox__reply.jsonl
```

Each line is a single recorded AG-UI event tagged with its step:

```jsonl
{"step":0,"event":{"type":"TEXT_MESSAGE_CHUNK","role":"assistant","delta":"Drafting…"}}
{"step":0,"event":{"type":"TOOL_CALL_START","toolCallName":"saveDraft",...}}
{"step":1,"event":{"type":"TEXT_MESSAGE_CHUNK","role":"assistant","delta":"Draft saved."}}
```

JSONL is used rather than a JSON array so that individual step appends do not rewrite the
whole file, diffs stay readable, and the format mirrors the line-delimited `stream-json`
the `claude` CLI already emits.

**Per-step replay-or-record decision.**
On each provider call the decorator computes `step = resolvedApprovalCount(input)` and
checks whether that step is already in the file. If yes, it yields the recorded events
without touching the real provider. If no (or if `mode=record`), it calls the real
provider, passes every event through unchanged, and appends each as `{step, event}` once
the run completes normally. A provider error does not write anything — the cassette stays
clean.

The `CassetteStore` uses atomic writes (temp file + rename) so a Ctrl-C mid-write cannot
corrupt an existing cassette.

## Sharing a cassette — READ THIS

Recordings hold real captured data from live runs: real email text, sender addresses,
ticket content, and possibly tokens or secrets that leaked into a tool result. The
`apps/inbox/.cassettes/` directory is in `.gitignore` and is **never committed by default**.

Before sharing, committing, pushing, or removing a cassette from `.gitignore`, the
following steps are mandatory:

1. **Warn explicitly** — recordings contain real captured data and must be reviewed
   before they leave the machine.

2. **Run the safety scan** — `scanCassette` (exported from
   `apps/inbox/server/record-replay.ts`) performs a regex/keyword pass over the JSONL
   text and flags emails, phone numbers, and token-shaped or keyword-tagged secrets
   (`sk-…`, `sk-ant-…`, `ghp_…`, `AIza…`, raw JWTs, and `api_key=` / `Authorization:`
   style patterns). Every finding is reported with its 1-based line number and the
   offending snippet so the exact exposure is visible.

3. **Wait for the user to confirm or scrub** before proceeding. If the scan returns
   nothing, say so clearly. If it returns findings, the user decides what to redact.

The scan is a heuristic safety net, not a guarantee. Personal names and postal addresses
are not reliably detectable by regex. **The human is the final reviewer.** The agent-side
rule for this is recorded permanently in `CLAUDE.md` ("Cassette share-safety") so it
survives across sessions.
