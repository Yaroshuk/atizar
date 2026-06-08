# Handoff — where we are & what's next

Living session state: **current status + the next thing to build**. Changes every session.
For stable project context (conventions, gotchas, decisions, commands) see `CLAUDE.md`; for the
full chronological build history see `docs/BUILD-LOG.md`.

## ⏭️ Where we are now

### 🐞 Known bugs — agent instances (NEXT, not yet fixed)

- **One-time deliveries spawn duplicate instances.** Some handoffs are a one-shot action on a single
  item — e.g. the email agent gets ONE email and the human clicks "Draft reply" 3×; today that spawns
  3 reply instances for the same email. A one-time/idempotent delivery should dedupe (one instance per
  source item) — clicking again should focus/no-op, not spawn a duplicate. (Dedupe was deferred in the
  spec; promote it.) Needs a delivery identity (e.g. source item id / threadId on the payload).
- **Second awaiting-approval instance's approve button is dead.** With two reply instances both in
  `awaiting_approval`, approving one worked; on the OTHER the "Save draft" / approve button did nothing.
  Likely the HITL `respond` callback is captured for only one instance (the active/last one) — the
  generative-UI render/HITL registration is shared and may not route `respond` to the right proxy when
  multiple instances await at once. Investigate `useWorkflowRenders`/`useHumanInTheLoop` + per-instance
  routing (cf. the `origin`-param pattern) so each awaiting instance's approval resumes ITS own run.

**On `master` (MERGED `5d13f3f`, BUILT, browser-verified):** **dynamic agent instances** — a
busy agent now spawns additional concurrent copies for new handed-off items instead of overwriting the
in-flight run. Each instance is a client-side **proxied agent** (`copilotkit.registerProxiedAgent`,
localId `wf__agent#<seq>`) created on demand, run, and `unregister`'d on finalize; the server is
unchanged (one agent per `wf__agent`). Concurrency is bounded per-agent by `defineAgent.maxInstances`
(default 2; `triage`+`qualifier` = 1); overflow waits in a per-agent queue that auto-drains on a freed
slot. The pipeline is rebuilt as an **instance tree** (`pipelineModel.buildPipeline`): repeated depth-2
`parent → [children grouped by agentId]` blocks — 1 instance = a single card, ≥2 = an agent header
(`N active`) + L-connected nested cards + a `queued: N` line; the right-grid "type" card shows the
aggregate (`N active · M awaiting approval`). Pure, unit-tested core: `instancesCore` (cap),
`statusFrom`, `aggregate`, `pipelineModel`; integration in `useAgentInstances` + `InboxView` +
`PipelineColumn` + `AgentCard`. **137 unit tests + typecheck/lint/prettier green.** **Browser-verified
E2E** on the real Magma board: routed 3 tickets at once → **2 active + `queued: 1`** (cap held against a
same-tick burst after a `synchronous instRef` fix), queue drained when a slot freed, single-instance
renders as one card, input agent kept, done workers torn down — **no page reload throughout**. Spec →
`docs/superpowers/specs/2026-06-08-agent-instances-design.md`; plan →
`docs/superpowers/plans/2026-06-08-agent-instances.md`; detail → `docs/BUILD-LOG.md` §9.
**Lesson logged (CLAUDE.md):** an "app reloads itself ~30s into a run" symptom was NOT a feature bug —
it was 5 stale dev stacks contending for `:5173` and tripping Vite's `vite:ws:disconnect → location.reload`
(the kill pattern in CLAUDE.md pointed at the wrong `node_modules` path; now fixed).
**Post-merge polish also landed & browser-verified:** idle agent cards open a type view (intro + START);
a handoff note carries an "Open <agent>" jump button; `awaiting_approval` instances are KEPT on finalize
(claude-cli HITL kills the process at the approval tool call — they must stay, not vanish); opening an
agent with ≥2 live instances shows an **instance picker** (cards, pick a copy) instead of one thread; the
pipeline parent→children connector is the prior centered `↓` with a bordered container over the children.
**Next for the following agent:** the two 🐞 at the top (one-time-delivery dedupe; second
awaiting-approval instance's approve button is dead) are the priority — both real and reproducible. Then
the optional follow-ups below. Pre-existing cosmetic: the model sometimes narrates "Let me load the tool
schemas first" into the thread (deferred-polish list).

**On `master` (MERGED `8b67b83`, BUILT, browser-verified):** the **tool-result surfacing +
consumer-thread polish** pass. Root cause unified three symptoms: MCP tool RESULTS never
reached the client (`claude-stream` emitted only START/ARGS/END). Now the provider emits
`TOOL_CALL_RESULT` for surfaced tools, which (a) flips a tool chip Running→Done (the default
chip waits on a `toolMessage` that never arrived → stuck "Running") and (b) hands the data to
the client directly. On top: **dev mode** (`?dev=1`, persisted) — the consumer thread shows
ONLY generative-UI cards; internal data-fetch chips (`list_my_tickets`, `get_latest_email`)
are hidden unless dev mode is on (`AgentModal` filters by the registered render/HITL tool
names). **TRIAGE no longer couriers tickets through the model**: `render_triage` shrank to
`{origin, recommendations:[{number,route}]}` (tiny + fast); the TriageCard reads ticket DATA
from the surfaced `list_my_tickets` result via a `ThreadResultsContext`, merging the model's
route. Plus visual fixes: triage rows stack (title wraps, action buttons wrap, no overflow);
`ReplyDraftCard` uses the proper head/badge/kicker (label no longer overlaps the title); and
contiguous text deltas now share ONE `messageId` (AG-UI `TEXT_MESSAGE_CHUNK` opened a new
message per differing id → "Draf"/"ted a reply" split into two bubbles). 127 unit tests +
typecheck/lint/prettier green. **Browser-verified E2E** (real Magma board, real reply draft):
normal mode = clean cards (no `list_my_tickets` chip, no stuck Running); dev mode = the chip
shows and reads **Done**; triage card + reply card lay out correctly; the narration is one bubble.
**Next:** commit this, then pick from "Other next-ups" / "PLANNED NEXT" below.

**On `master` (MERGED `3a92241`, BUILT, browser-verified):** the **workflow-
separation** pass. Each workflow is now a **self-contained module** (`apps/inbox/workflows/<id>/`
descriptor+server+client) and workflows are **isolated boxes** that talk only through a typed
**published contract**. Highlights: `@platform/core` `defineWorkflow` + `instanceId` +
`Destination`; agent **roles `input`/`worker`** (input = user-startable + only cross-workflow target;
worker = handoff-only); **all agents of all workflows mounted idle** keyed by instance id (so the same
agent is reusable as independent copies and a cross-workflow target is always ready — no mount race);
one **`deliver`** seam that runs the target in the **background** with **no auto-open** and **no
auto-switch** (cross-workflow raises a tab **badge** + an "Open in <workflow>" button; the human
navigates); **origin-routed** handoff render tools so reused handoff-emitting agents route to the
right copy; a concrete demo — TRIAGE's "Treat as lead → Lead inbox" delivers a ticket to the
lead-inbox `lead` contract and the qualifier re-qualifies the handed lead. 120 unit tests +
typecheck/lint/prettier green. **Browser-verified E2E** (real Magma board read-only + real Gmail):
intra-handoff runs target w/ no auto-open; cross-workflow delivery → background run + badge + no
switch + Open-in; **state persists across workflow switches**. Detail → `docs/BUILD-LOG.md` §8;
spec → `docs/superpowers/specs/2026-06-08-workflow-separation-design.md`; plan →
`docs/superpowers/plans/2026-06-08-workflow-separation.md`.
**Next:** pick from "Other next-ups" / "PLANNED NEXT" below.

**Previously on `master` (MERGED, BUILT, browser-verified on the real board):** the **GitHub triage
workflow** — a second workflow beside the Lead inbox, built on the **real** Magma Board (GitHub
Projects v2, `matteappen` #8) via `gh`, **strictly read-only**. A **TRIAGE** agent (the only board
reader) lists the user's assigned tickets, buckets them by real Status + a "needs reply" flag,
and recommends a route; the manager routes one via the `handoff.ts` seam to **FEATURE /
BUG-FIX / REPLY-DRAFT**, which analyze/draft **purely from the handoff payload** (no GitHub access).
Detail → `docs/BUILD-LOG.md` §7; spec → `docs/superpowers/specs/2026-06-07-github-triage-workflow-design.md`;
plan → `docs/superpowers/plans/2026-06-07-github-triage-workflow.md`.

**Previously on `master` (MERGED `56c8454`, BUILT, browser-verified):** the **consumer desktop
re-skin** — Smedja design system on `apps/inbox/client`; flat two-card view → **two-panel desktop**
(left **Pipeline** column + right **Your agents** grid under the same thin `.comp-head`). Pipeline
shows only active agents (tinted, ↓-connected) and **keeps a handoff parent visible as Working
while its subagent runs**; reply is handoff-only. Detail → `docs/BUILD-LOG.md` §6.

**Recently built (deep dives → `docs/BUILD-LOG.md`):**

1. Vertical slice + reusable **`@platform/core`** layer (message layer, `Provider` contract,
   `defineAgent` passport). — §1
2. **`claude-cli` provider** — runs the real `claude` CLI as a subprocess behind the `Provider`
   seam; HITL = detect-tool-call-and-kill + stateless re-prime resume. — §2
3. **Gmail draft integration** — our own thin stdio Gmail MCP; reads latest email → draft reply on
   approval (never sends). — §3
4. **Two agents + manual handoff** (`56f07d0`) — LEAD QUALIFIER (only reader) → REPLY AGENT
   (writer); `handoff.ts` is the pure encode/decode seam; per-agent MCP allow-list = hard boundary. — §4
5. **`@platform/*` package split** — `core` + `providers` + `integrations` as yarn-classic
   workspace packages consumed as raw TS source. — §5
6. **Consumer desktop re-skin** (`56c8454`) — above. — §6
7. **GitHub triage workflow** (MERGED) — real read-only Magma Board, N-agent
   desktop + switcher. — §7
8. **Workflow separation** (`feat/workflow-separation`, browser-verified, unmerged) — self-contained
   workflow modules, `input`/`worker` roles, all-mounted-idle instance reuse, published-contract
   cross-workflow delivery, `deliver` seam with no auto-open/auto-switch. — §8
9. **Dynamic agent instances** (`feat/agent-instances`, browser-verified) — a busy agent spawns
   concurrent proxied copies (cap `maxInstances`, default 2; overflow queued), shown as a nested
   instance tree in the pipeline. — §9

## 🧭 PLANNED NEXT

- **Workflow-separation follow-ups it deferred** (all optional, nothing blocking): URL routing per
  workflow; per-workflow CopilotKit contexts (full render-tool isolation); Variant 2 type-matched
  contract discovery (source emits a typed parcel, system offers compatible workflows — no naming);
  a live demo reusing one agent across two workflows; clearing per-instance `handoffNotes` when an
  agent is re-seeded (cosmetic — a re-seeded agent still shows its prior "sent" note); show the
  workflow _label_ instead of the raw id in the "Open in" button / handoff notes.
- The GitHub data path is **real and read-only by construction**. A real-time refresh, broader
  scoping (beyond the single assignee), or Projects-v2 status writes are explicitly **out of scope**
  unless the read-only constraint is revisited (it is a hard rule — see CLAUDE.md / memory).

### Known issues / tech debt (GitHub triage)

- ✅ **FIXED (this session):** **`list_my_tickets` chip shows "Running" forever.** Root cause: the
  provider never surfaced tool RESULTS, so the default chip's `toolMessage` never arrived. Now
  `claude-stream` emits `TOOL_CALL_RESULT` → chip flips to Done. In normal mode the chip is hidden
  entirely (only cards show); dev mode (`?dev=1`) shows it, now correctly Done.
- ✅ **FIXED (this session):** **TRIAGE couriered every ticket through `render_triage`.** The robust
  fix landed: the client reads the `list_my_tickets` RESULT (now surfaced) via `ThreadResultsContext`,
  and `render_triage` carries only `{origin, recommendations}`. The model no longer re-emits ticket
  text → no latency/timeout scaling wall. The `MAX_TICKETS`/trim knobs now only bound the streamed
  result payload, not model latency.

## Other next-ups (suggested order)

1. **Finish the split — `@platform/react` + `@platform/server` extraction (deferred):** the
   client React layer and the Hono/BFF + spawn server layer still live in `apps/inbox/`. Extract
   when the app/framework boundary settles. The `@platform/*` scope is a **placeholder** — rename
   before any npm publish.
2. **Multi-provider / Mastra** (can interleave): add a `mastra` (or `claude-api`) factory beside
   `claude-cli` behind the existing `Provider` seam in `@platform/providers` — no seam change
   needed. Needs an API key.
3. _Polish (cosmetic, deferred):_ the model still narrates a bit ("I'll load the tool schemas…")
   AND the verdict prints as plain markdown paragraphs in the modal alongside the card — strip
   pre-tool / duplicate chatter client-side or via prompt. Tighten Gmail scope
   `gmail.modify`→`readonly`+`compose`.
