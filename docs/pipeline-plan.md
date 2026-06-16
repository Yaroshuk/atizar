# Communication Pipelines — design plan

A **thinking doc** for how workflows, agents, and agent-actions talk to each other and how
their results are presented. It captures open problems + the current model + options, marking
**DECIDED** vs **OPEN**. Not a spec yet — we think the pipelines through here first, then spin
specific items into `docs/superpowers/specs/`.

Spun out of the session that fixed two agent-instance bugs (one-time-delivery **dedup** and
**per-instance HITL**, both BUILT + browser-verified — see `HANDOFF.md`) and surfaced three more
gaps below.

---

## Current model (BUILT — for reference)

- **Workflows** are self-contained modules; agents carry a **role**: `input` (user-startable, the
  only cross-workflow target) or `worker` (handoff-only).
- **`deliver` seam** (`client/src/deliver.ts` + `InboxView.deliver`): `intra` (a `{kind:'agent'}`
  destination in the same workflow) or `cross` (a `{kind:'contract'}` to another workflow's
  published `inputs`). Runs the target in the BACKGROUND — no auto-open, no auto-switch (cross-
  workflow raises a tab badge + "Open in <wf>").
- **`handoff`** is the pure encode/decode payload seam.
- **Instances** (`useAgentInstances`): a busy agent spawns concurrent **proxied** copies (cap
  `maxInstances`, overflow queued). The pipeline is rendered as an **instance tree**.
- **Teardown** (`useAgentInstances.onFinalized`): an instance is KEPT iff it is an `input` agent,
  has a live child, finalized as `error`, or finalized `awaiting_approval`. **Otherwise `done` →
  torn down** (unregistered + removed). ← root of P1 below.
- **HITL** is client-held: the run finalizes at the approval tool call (claude-cli kills the
  process); resume = stateless re-prime. Registration is now **per live instance** (`InstanceTools`,
  `agentId = localId`) + the open modal is wrapped in `<CopilotChatConfigurationProvider>`.
- **Result surfacing**: render tools draw cards; a data tool's raw result reaches cards via
  `ThreadResultsContext`. Only registered render/HITL tool names show in the consumer thread.
- **Dedup** (new): a delivery carries a dedup `source` (source-item identity, app-supplied via
  `sourceOf` at dispatch); a repeated one-time delivery is a no-op.

---

## Observed problems

### P1 — Worker results VANISH (no terminal "result" lifecycle) — **highest impact**
Route a ticket from TRIAGE to **FEATURE / BUG-FIX / REPLY-DRAFT**: the worker runs, renders its
result card (plan / analysis / suggested reply), finalizes as `done` — and `onFinalized` **tears it
down immediately** because a `done` worker is none of {input, has-live-child, error,
awaiting_approval}. The result card disappears; the user sees no output and cannot act on it.

The lifecycle has no notion of *"completed and produced a result the human should still see."*
Approval-bearing workers survive (they finalize `awaiting_approval`); result-only workers don't.

**Options**
- **(a)** Add a keep condition: a `done` instance that **produced a render result** stays until the
  user dismisses it. Needs a "result produced" signal (e.g. the thread contains a registered render
  tool call) and a dismiss affordance.
- **(b)** Detach the result from the instance: persist the result card as a durable artifact on the
  parent / in the pipeline, independent of instance teardown.
- **(c)** A per-workflow "results" surface (an outbox/inbox) that collects finished worker outputs.
- **OPEN Q:** what marks a worker "done for good" vs "has a result to show"? What's the dismiss
  model — manual close, auto-expire, or "archive on next run"?

### P2 — Intro bubble shows ALWAYS (even idle)
`AgentModal` always renders the green intro bubble. For an idle **type view** it stands in for a
description; for a running instance it heads the thread. So the "Reading your inbox…/Drafting…"
line shows even when nothing is running.

**DECIDED direction:** gate the running-intro on lifecycle (show it only once the instance has
started — `running` or has messages). For the idle type view, show a distinct **static
description** of what the agent does, not the in-progress intro. (Two strings: `description` for
idle, `intro` for active.)

### P3 — One-time action button stays active after use
The VerdictCard "Draft reply" stays clickable after it's been used. With dedup, a second click is a
no-op — but the UI gives no feedback, so it looks broken/repeatable.

**Options:** disable / relabel the button ("Reply drafted ↗", links to the spawned instance) once a
delivery for that source item exists.
- **OPEN Q:** where does the card learn "already delivered"? It needs the delivery state keyed by
  the dedup `source` — lift that to a context the card reads (the `deliver` layer already computes
  the key; expose "live deliveries by key").

---

## Pipeline matrix — think each path through

For each path: **trigger → payload → target → result presentation → lifecycle**. ✅ = works today,
⚠️ = gap.

| # | Path | Result presentation | Lifecycle |
|---|------|--------------------|-----------|
| 1 | **Input run** (user START): reads source → renders verdict/triage card | ✅ card in its own thread | input kept as pipeline root ✅ |
| 2 | **Intra handoff → approval worker** (verdict "Draft reply" → REPLY) | ✅ approval dialog → resume → saved | kept `awaiting_approval`, torn down after approve ✅ |
| 3 | **Intra handoff → result-only worker** (TRIAGE → FEATURE/BUGFIX/REPLY-DRAFT) | ⚠️ card renders then **vanishes** (P1) | `done` → torn down ⚠️ |
| 4 | **Cross-workflow contract** (TRIAGE "Treat as lead" → lead-inbox.`lead`) | ⚠️ no preview; must open the other workflow | background spawn + badge ✅ |
| 5 | **Multi-instance same agent** (2 reply copies) | ✅ instance tree + picker | cap/queue ✅; per-instance HITL ✅ (fixed) |

---

## Cross-cutting open questions (for the next session)

1. **A uniform RESULT lifecycle.** Promote the implicit states to explicit:
   `running → (awaiting_approval | result | error) → kept until dismissed`; only
   `done-without-result` is torn down. This single change fixes **P1** and gives **P3** a clean
   "this item has been acted on" signal. — **OPEN, recommended starting point.**
2. **Where does delivery/action state live** so a source card can reflect "already acted" (P3) and
   so the pipeline can show "→ produced result X"? Probably a deliveries-by-`source` map lifted
   beside the instance list.
3. **Intro vs description split** (P2) — small, can land independently.
4. **Cross-workflow result visibility** (path 4): always navigate, or preview the produced result in
   the origin (a "peek")?
5. **Dedup/idempotency policy** (path 2/3): today every delivery with a dedup `source` dedupes. Which
   deliveries are genuinely one-time vs legitimately repeatable (e.g. "re-analyze")? Make it explicit
   per destination rather than implicit-by-key.

---

## Notes / non-goals

- GitHub stays **strictly read-only** (see `CLAUDE.md`); REPLY-DRAFT only *drafts* a suggested
  comment as generative UI — so its result is exactly the kind of "render-only result" P1 is about.
- This doc is living; as items get decided, move them into a dated spec under
  `docs/superpowers/specs/` and link back here.
