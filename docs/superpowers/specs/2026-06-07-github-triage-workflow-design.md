# GitHub triage workflow — real Magma Board, read-only

_Spec · 2026-06-07 · **DESIGN — not yet built**_

> A second workflow beside the Lead inbox: a **TRIAGE** agent reads the user's own
> tickets off the **real** GitHub Projects v2 board (`matteappen` org, project #8 —
> "Magma Board") via the `gh` CLI, buckets them by Status, and surfaces a routing
> recommendation per ticket. The manager routes a ticket (manual handoff, reusing
> `handoff.ts`) to one of three downstream agents — **FEATURE**, **BUG-FIX**,
> **REPLY-DRAFT** — which analyze/draft purely from the handoff payload.
>
> **STRICTLY READ-ONLY.** Nothing is ever posted, commented, written, or modified on
> GitHub. Only `gh project item-list` / `gh issue view` style reads. See
> `CLAUDE.md` and memory `github-read-only`.

## Goal

Build the GitHub triage case described in `HANDOFF.md`, generalized to the **real**
Magma Board, while keeping the existing Gmail/Lead-inbox workflow fully intact. This
forces the **N-agent desktop** (a workflow registry + a lightweight switcher
**Lead inbox ↔ GitHub triage**) that was deferred until now.

The triage idea is the same shape as the lead-qualifier → reply handoff, generalized
to N downstream agents and a ticket-shaped payload.

## Why real `gh` instead of a mock MCP

The provider is `claude-cli` — it runs the real `claude` binary, which has Bash + an
authenticated `gh` (account `Yaroshuk`, scopes include `read:project`/`project` after
`gh auth refresh`). The board is a real Projects v2 board with 1785 items; the user is
assigned **27** of them across real statuses. So "real GitHub" needs no invention —
only a thin **read-only** adapter over `gh`. The originally-planned mock MCP is dropped.

Validated facts (all read-only, confirmed in this session):

- `gh project item-list 8 --owner matteappen --format json` → items with
  `{assignees, content:{body,number,repository,title,url}, priority, repository, status, title}`.
- Status field options: `Backlog, Todo, In progress, On pluto, Ready for mars, On mars,
  Ready for venus, On venus, Ready for prod, Verify on prod, Done`. Priority: `High/Medium/Low`.
- `gh issue view <n> -R <owner/repo> --json comments,title,state` → comment thread with
  `author.login` + `body` (e.g. "verified on prod ✅", "@x can't reproduce on Mars…").

## Architecture

### 1. Read-only GitHub MCP adapter — `apps/inbox/mcp/github-tools.mjs`

Mirrors the **real** `gmail-tools.mjs` (NOT the render-only mock `inbox-tools.mjs`): a
thin stdio MCP that shells out to `gh` via `child_process`. Config via env/constants so
it is swappable: `GH_PROJECT=8`, `GH_OWNER=matteappen`, `GH_ASSIGNEE=Yaroshuk`.

**Read tools (the only data tools — no write tool exists in this file):**

- **`list_my_tickets`** → runs `gh project item-list`, filters to `GH_ASSIGNEE`, and for
  each ticket enriches the **last comment** (`gh issue view <n> -R <repo> --json comments`).
  Returns `[{ repo, number, title, status, priority, body, url,
  lastComment: { author, body } | null }]`. **triage only.**
- **`get_ticket`** (`{ repo, number }`) → full body + full comment thread for one ticket.
  **triage only** (used when the manager drills into / routes a ticket and triage needs
  the complete thread to build a rich handoff payload).

**Generative-UI tools (trivial acks, like the inbox render tools):**

- `render_triage` — surfaces the bucketed list.
- `render_ticket_result` — surfaces a FEATURE/BUG analysis.
- `render_reply_draft` — surfaces a suggested reply (preview text only).

The adapter is **read-only by construction**: it contains no `gh issue comment` /
`gh issue edit` / `gh project item-edit` / any mutating call. That is the structural
guarantee, independent of any allow-list.

### 2. Single board reader — only TRIAGE touches GitHub

**Only the TRIAGE agent reads GitHub.** Downstream agents (FEATURE, BUG-FIX, REPLY-DRAFT)
do **not** call `gh` at all — they receive the complete ticket inside the handoff payload
and analyze/draft purely from it. This is the "single entry point / board reader"
boundary from `HANDOFF.md`, made strict: downstream agents have **no GitHub read tool,
not even `get_ticket`**.

Consequence: the handoff payload must be **self-contained** (full body + relevant
comments), since downstream never fetches.

### 3. Handoff generalization — `packages/core/src/handoff.ts`

`encodeHandoff` is already schema-agnostic (it JSON-stringifies any payload). Generalize
the decode to be schema-parameterized and add a ticket payload:

- `decodeHandoff<T>(input, schema: ZodType<T>): T | null` — validate against the passed
  schema. The existing Gmail reply prompt updates its single call site to pass
  `HandoffPayloadSchema` (no behavior change).
- New `TicketHandoffPayloadSchema`:
  ```ts
  {
    repo: string,
    number: number,
    title: string,
    status: string,
    priority: string,
    body: string,
    lastComment: { author: string, body: string } | null,
    recommendation: string,   // triage's routing rationale, carried to downstream
    url: string,
  }
  ```
- `encodeHandoff` signature loosened to accept either payload (generic / union). Core
  stays pure & isomorphic (no React, no Node).

### 4. Agents — `apps/inbox/agents/github.agent.ts`

| agent          | id          | tools                                   | approvals | renders                                  | handoffs                     | touches GitHub |
| -------------- | ----------- | --------------------------------------- | --------- | ---------------------------------------- | ---------------------------- | -------------- |
| **TRIAGE**     | `triage`    | list_my_tickets, get_ticket, render_triage | —      | `render_triage` → `TriageCard`           | feature, bugfix, reply-draft | **yes (only)** |
| **FEATURE**    | `feature`   | render_ticket_result                    | —         | `render_ticket_result` → `TicketResultCard` | —                         | no             |
| **BUG-FIX**    | `bugfix`    | render_ticket_result                    | —         | `render_ticket_result` → `TicketResultCard` | —                         | no             |
| **REPLY-DRAFT**| `replyDraft`| render_reply_draft                      | —         | `render_reply_draft` → `ReplyDraftCard`  | —                            | no             |

- FEATURE / BUG-FIX: "dumb for now" — read the routed ticket from their handoff payload,
  produce an analysis/plan, render it. Read-only, no external effect.
- REPLY-DRAFT: when the last comment is a question / needs an answer, draft a **suggested**
  reply comment and render it as preview text. **Nothing is posted** — no approval gate,
  because nothing leaves the app.
- No agent has any `approvals` entry: the read-only GitHub flow has no
  human-in-the-loop write to pause (unlike the Gmail `saveDraft`).

`defineAgent` validates structure as today (`approvals ⊆ tools`, `renders` keys ⊆ `tools`,
`handoffs` ⊆ known ids at server wiring).

### 5. Server wiring & boundary — `apps/inbox/server/index.ts`

- Spawn the `github` MCP alongside `inbox` + `gmail`; strip the `mcp__github__` prefix.
- Per-agent allow-lists (the hard boundary, same pattern as `QUALIFIER_TOOLS`/`REPLY_TOOLS`):
  - `TRIAGE_TOOLS = [mcp__github__list_my_tickets, mcp__github__get_ticket, mcp__github__render_triage]`
  - `FEATURE_TOOLS = [mcp__github__render_ticket_result]`
  - `BUGFIX_TOOLS = [mcp__github__render_ticket_result]`
  - `REPLY_DRAFT_TOOLS = [mcp__github__render_reply_draft]`
- Register the 4 new agents in the same `CopilotRuntime.agents` map; both workflows
  coexist server-side (the client decides which subset to show).
- No agent ever receives a GitHub write tool. **Note:** Bash/Edit/Write/Read/Glob/Grep
  are already in the spawn `deny`-list (`claude-spawn.ts` `BUILTINS`), so the model has
  no shell at all — `gh` is invoked only by the MCP adapter process (not bound by the
  model's tool permissions). Read-only is enforced by the adapter exposing no write tool;
  there is no `Bash(gh …)` specifier (Bash is denied outright).

### 5a. Payload boundedness (refinement)

Because downstream agents never fetch, the ticket **body** must ride in the handoff
payload, and TRIAGE is the courier (same pattern as `renderVerdict`: the model passes
display data into the render tool's args). To keep the couriered payload bounded:
`list_my_tickets` **excludes `Done`** by default (triage is about what needs attention)
and **truncates each `body` to ~1500 chars** in the adapter. `render_triage` carries the
(trimmed) ticket array; a route click builds the `TicketHandoffPayload` from that ticket
row — self-contained, so FEATURE/BUG-FIX/REPLY-DRAFT analyze without any GitHub call.

### 6. Buckets — real Status + derived "needs your reply"

TRIAGE groups the user's tickets by the **real Status field** value. In addition it
derives a **"Needs your reply"** flag per ticket: the ticket is OPEN and its last comment
author is **not** the user (someone asked a question awaiting an answer). `TriageCard`
shows the status groups, highlights the needs-reply tickets, and per ticket shows the
routing recommendation + route buttons (→ feature / bugfix / reply-draft). Grouping is a
pure helper (`buckets.ts`) so it is unit-testable on a fixed JSON fixture, no network.

### 7. Client — N-agent desktop + workflow switcher

The current `InboxView` hardcodes two `useAgent` hooks. React's rules-of-hooks forbid a
variable-count loop, so generalize via a **per-agent child component**:

- **`AgentRuntime`** (new, one component per file): given an `AgentDefinition`, calls
  `useAgent` + `useAgentStatus` **once**, and publishes `{ agent, status }` up to the
  parent via a callback/registry. Mounting/unmounting on workflow switch resets its hooks
  cleanly (correct behavior).
- **`WorkflowView`** (generalized `InboxView`): maps over the current workflow's
  `agents`, rendering one `AgentRuntime` slot each, then builds the pipeline nodes, the
  "Your agents" grid, and the conversation modals by `.map` over that list.
- **`workflows` registry** (client): `[{ id, label, iconName, agents, entryAgentId }]`.
  - Lead inbox = `[qualifier, reply]` (unchanged behavior).
  - GitHub triage = `[triage, feature, bugfix, replyDraft]`.
- **`WorkflowSwitcher`** — lightweight tabs (Lead inbox ↔ GitHub triage). The design's
  "workflow tabs" minus the dropped top bar.
- **`<CopilotKit agent={...}>`** keeps a valid registered default agent (the active
  workflow's `entryAgentId`).
- New render components (one per file): `TriageCard`, `TicketResultCard`, `ReplyDraftCard`
  — added to `renderRegistry` and registered in actions. Tool names are globally unique,
  so all workflows' render tools register unconditionally (stable hook count).
- `META` (subtitle + icon, client-side) extended for the 4 GitHub agents.

The Gmail workflow is unchanged in **behavior**; only `InboxView` is refactored into the
generic `WorkflowView` with Gmail as one registry entry.

## Data flow (GitHub triage)

1. User switches to **GitHub triage**, opens TRIAGE, clicks START.
2. TRIAGE calls `list_my_tickets` (real `gh` read, scoped to `Yaroshuk`), groups by
   Status, derives needs-reply, calls `render_triage`. `TriageCard` shows the buckets +
   per-ticket route buttons.
3. User clicks a route button on a ticket → client builds a `TicketHandoffPayload`
   (TRIAGE may first `get_ticket` for the full thread), `encodeHandoff` seeds the target
   agent's run, launches it, opens its modal — exactly the existing handoff seam.
4. FEATURE / BUG-FIX reads the payload from its own run input (`decodeHandoff`), analyzes,
   calls `render_ticket_result`. REPLY-DRAFT drafts a suggested reply, calls
   `render_reply_draft`. None of them call `gh`.

## In scope

- Read-only `github-tools.mjs` adapter (real `gh`).
- 4 GitHub agents + server wiring + allow-lists.
- Core `decodeHandoff` generalization + `TicketHandoffPayloadSchema`.
- N-agent `WorkflowView` + `AgentRuntime` + `workflows` registry + `WorkflowSwitcher`.
- `TriageCard`, `TicketResultCard`, `ReplyDraftCard` + `buckets.ts`.
- Unit tests + browser E2E on the real board.

## Out of scope

- **Any GitHub write** (post/comment/edit/move/close/label) — forbidden, permanently.
- Agent-initiated routing (TRIAGE auto-routes without a human) — manual now; the seam
  already supports it later.
- A real GitHub *write* MCP, Projects v2 mutations, status changes.
- Extracting `@platform/react` / `@platform/server` (still deferred).
- Server-side board pagination/caching beyond the single scoped `list_my_tickets` call
  (27 items is small; if `list_my_tickets` ever broadens, log any cap).

## Testing

- **Unit:** generic `decodeHandoff` with a `TicketHandoffPayload`; `buckets.ts` grouping
  + needs-reply derivation on a fixed `gh project item-list` JSON fixture (no network);
  N-agent `canStart` / pipeline-node derivation. Keep the existing 88 green.
- **Browser E2E (real board):** switch to GitHub triage → START → see the real 27 tickets
  bucketed by Status with needs-reply highlights → route a feature-shaped ticket to
  FEATURE and a bug-shaped one to BUG-FIX (handoff → analysis card) → route a
  question-comment ticket to REPLY-DRAFT (suggested reply preview). Confirm the Gmail
  workflow still works after the switcher refactor.

## Open questions

None outstanding. Read-only is a hard constraint; the single-board-reader boundary and
the workflow switcher are confirmed.
