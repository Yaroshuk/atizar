# Handoff — where we are & what's next

Living session state: **current status + the next thing to build**. Changes every session.
For stable project context (conventions, gotchas, decisions, commands) see `CLAUDE.md`; for the
full chronological build history see `docs/BUILD-LOG.md`.

## ⏭️ Where we are now

**On `master` (MERGED `56c8454`, BUILT, browser-verified):** the **consumer desktop re-skin** —
the Smedja design system applied to `apps/inbox/client`. The flat two-card view is now a
**two-panel desktop**: a left **Pipeline** column + a right **Your agents** grid, each under the
SAME thin `.comp-head`. Pipeline shows only active agents (tinted, connected by handoff ↓) and
**keeps a handoff parent visible as Working while its subagent is active**; reply is handoff-only
(no START). 88 unit tests, all green, browser-verified on real Gmail. Detail →
`docs/BUILD-LOG.md` §6; spec → `docs/superpowers/specs/2026-06-07-consumer-desktop-reskin-design.md`.

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

## 🧭 PLANNED NEXT — GitHub triage workflow (NOT STARTED; design agreed, no code)

The next real case the user wants, built on the re-skinned desktop. **The triage idea is
the same shape as the lead qualifier → reply handoff, generalized to N downstream agents.**

- **TRIAGE agent** (the board reader, single entry point): reads a ticket board, buckets
  tickets by status — **In progress · Waiting your reply · To do** — reading each ticket's
  status + last comment. Surfaces a **TriageCard**: the bucketed list, each ticket with a
  routing recommendation + route buttons.
- **Routing** (manual now, human trigger; agent-initiated later — reuse `handoff.ts`): the
  manager routes each ticket to a downstream agent via the existing handoff seam, but the
  payload is **ticket-shaped** (so `handoff.ts` needs a generic/second payload, or a
  `TicketHandoffPayload`). Three downstream agents:
  - **FEATURE agent** — gets a ticket link, reads the description, returns an analysis/plan
    (dumb for now: read → render result).
  - **BUG-FIX agent** — same shape, bug-oriented.
  - **REPLY agent** — when the last comment is a question / needs an answer, drafts a
    suggested reply comment for human approval (mirror the Gmail reply HITL).
- **Data is MOCKED** (user OK'd it): a thin **mock GitHub stdio MCP** (`mcp/github-tools.mjs`,
  mirroring `mcp/inbox-tools.mjs`) with canned tickets + `list_tickets` / `get_ticket` +
  generative tools (`render_triage`, `render_ticket_result`, `post_comment`). Real
  claude-cli provider drives it (same as the Gmail case — only the data source is mock).
  A real GitHub MCP (Projects v2 = GraphQL, or Issues = REST) can swap in later.
- **Desktop:** this forces the **N-agent desktop** (deferred until now): generalize
  `InboxView` to map over a workflow's agent list instead of hardcoding two, and add a
  **lightweight workflow switcher** (Lead inbox ↔ GitHub triage) — the design's "workflow
  tabs" minus the dropped top bar. Keep the Gmail workflow intact.
- **Boundary:** TRIAGE = the only board reader; downstream agents are writers/analyzers
  with no `list_tickets` — enforce via the per-agent MCP allow-list in `server/index.ts`
  (same pattern as `QUALIFIER_TOOLS`/`REPLY_TOOLS`).

A first half-built attempt (mock MCP + a `buckets.ts` grouping helper) was discarded — start
fresh. Brainstorm/visual-companion mocks for the two-panel layout live (gitignored) under
`.superpowers/brainstorm/`.

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
