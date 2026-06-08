# Handoff — where we are & what's next

Living session state: **current status + the next thing to build**. Changes every session.
For stable project context (conventions, gotchas, decisions, commands) see `CLAUDE.md`; for the
full chronological build history see `docs/BUILD-LOG.md`.

## ⏭️ Where we are now

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

## 🧭 PLANNED NEXT

- **Workflow-separation follow-ups it deferred** (all optional, nothing blocking): URL routing per
  workflow; per-workflow CopilotKit contexts (full render-tool isolation); Variant 2 type-matched
  contract discovery (source emits a typed parcel, system offers compatible workflows — no naming);
  a live demo reusing one agent across two workflows; clearing per-instance `handoffNotes` when an
  agent is re-seeded (cosmetic — a re-seeded agent still shows its prior "sent" note); show the
  workflow *label* instead of the raw id in the "Open in" button / handoff notes.
- The GitHub data path is **real and read-only by construction**. A real-time refresh, broader
  scoping (beyond the single assignee), or Projects-v2 status writes are explicitly **out of scope**
  unless the read-only constraint is revisited (it is a hard rule — see CLAUDE.md / memory).

### Known issues / tech debt (GitHub triage — not blocking, user accepted)

- **`list_my_tickets` chip shows "Running" forever** in the agent thread even after the run is Done.
  It's a data tool with no registered render component, so `useRenderToolCall`'s default chip never
  flips to done (Gmail's `get_latest_email` has the same look). Cosmetic. Fix = register a tiny
  renderer for data tools, or hide unregistered tool chips.
- **TRIAGE couriers every ticket through `render_triage`** (the model re-emits the array token by
  token). Mitigated for now (status filter + cap 20 + trimmed body/comment + 180s timeout), but it's
  a latent scaling limit — more/larger tickets re-introduce slow runs / timeouts. Robust fix: have
  the client read the `list_my_tickets` tool RESULT from the message stream directly instead of the
  model re-emitting it into the render tool.

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
