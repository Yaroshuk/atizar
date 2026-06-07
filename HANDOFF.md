# Handoff — where we are & what's next

Living session state: **current status + the next thing to build**. Changes every session.
For stable project context (conventions, gotchas, decisions, commands) see `CLAUDE.md`; for the
full chronological build history see `docs/BUILD-LOG.md`.

## ⏭️ Where we are now

**On `feat/github-triage-workflow` (BUILT, browser-verified, NOT yet merged):** the **GitHub triage
workflow** — a second workflow beside the Lead inbox, built on the **real** Magma Board (GitHub
Projects v2, `matteappen` #8) via `gh`, **strictly read-only**. A **TRIAGE** agent (the only board
reader) lists the user's 27 assigned tickets, buckets them by real Status + a "needs reply" flag,
and recommends a route; the manager routes one via the existing `handoff.ts` seam to **FEATURE /
BUG-FIX / REPLY-DRAFT**, which analyze/draft **purely from the handoff payload** (no GitHub access).
This forced the **N-agent desktop**: `InboxView` → `WorkflowView` mapping over a `workflows`
registry, each agent's hooks owned by a child `AgentRuntime` (rules-of-hooks fix), with a
**WorkflowSwitcher** (Lead inbox ↔ GitHub triage). Gmail workflow unchanged in behavior. 103 unit
tests green; browser-verified E2E on the real board (20 tickets bucketed → route → analysis;
read-only confirmed — comment count unchanged) and Gmail re-verified intact. Detail →
`docs/BUILD-LOG.md` §7; spec → `docs/superpowers/specs/2026-06-07-github-triage-workflow-design.md`;
plan → `docs/superpowers/plans/2026-06-07-github-triage-workflow.md`.
**Next:** merge this branch to `master`, then the planned **workflow-separation** pass.

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
7. **GitHub triage workflow** (`feat/github-triage-workflow`) — real read-only Magma Board, N-agent
   desktop + switcher. — §7

## 🧭 PLANNED NEXT — workflow separation + merge

- **Merge `feat/github-triage-workflow` to `master`** (browser-verified, read-only, 103 tests green).
- **Workflow-separation pass** (the user flagged this comes after GitHub triage): right now both
  workflows coexist in one `CopilotRuntime` and one client `workflows` registry, switched by tabs.
  The user wants a cleaner separation of flows — likely per-workflow config/routing/desktop chrome
  rather than one shared `WorkflowView`. Scope to be brainstormed when started.
- The GitHub data path is **real and read-only by construction**. A real-time refresh, broader
  scoping (beyond the single assignee), or Projects-v2 status writes are explicitly **out of scope**
  unless the read-only constraint is revisited (it is a hard rule — see CLAUDE.md / memory).

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
