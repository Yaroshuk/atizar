# Spec — Re-run semantics + trust/UX improvements

**Status:** design (decisions LOCKED, 2026-06-14). Branch context: authored on
`analysis/workflow-rerun-semantics`. This spec turns the re-run **analysis**
(`2026-06-14-workflow-rerun-semantics-BRIEF.md` + the Notion analysis page) **plus four adjacent
issues the user surfaced while reviewing the running app** into one buildable design. Each
work-stream (WS) below becomes its own plan in `docs/superpowers/plans/` and its own branch off
`master`.

**Author's note to the implementing agent:** the decisions here are made and locked — the user
delegated all decisions and is running this autonomously. Do **not** re-open them. If a decision
turns out to be wrong mid-build, note it, pick the obvious fix, and keep going (the user works
autonomously). Your job is the green-gate'd, browser-verified implementation of each WS, in order.

---

## 0. Foundation check (already run — CLEAR with guard-rails)

`check-foundation` was run against this whole design (verdict recorded in the session that authored
this spec). **CLEAR**, with these **hard guard-rails for WS1** (do not drift past them):

- **I8** — every `work_items.status` write goes through `transition()`; the supersede is a new
  edge (or reuse of an existing one), **never** a side-write in `dispatch.ts` or a route.
- **I12** — "supersede" means the new scan becomes the *current* one and the prior finished scan is
  **moved to a preserved Done/history bucket (still human-openable and human-closable), NOT
  destroyed.** All per-item work items (the durable unit) stay fully durable and human-closed.
  Nothing a human started is silently deleted.
- **I1** — a human START must **always** do something visible. Do **NOT** implement "no-op when
  nothing changed." (Item-level dedup is fine; refusing the human's explicit gesture is not.)
- **I9** — the irreversible action stays server-executed + gated, keyed `workItemId+gateId`. The
  dedup-scope change (WS1) leans on this ledger as the real double-action guard.

WS2 strengthens the framework/userland boundary (I5). WS5 + durable audit reinforce I1. WS3/WS4 are
pure client presentation.

---

## 1. Background (what's true today — verified in code)

- **`packages/server/src/dispatch.ts` is the ONE dispatch chokepoint.** A human START carries
  `source: null` → the `if (input.source)` dedup is **skipped** → every START mints a fresh root
  work item (`dispatch.ts:62-75`). Child/handoff dispatch carries `source` (e.g.
  `thread:<threadId>` from `deliveryKey`, `packages/core/src/delivery.ts:37-45`) and **dedups
  against live OR finished** same-source items, excluding only `error`/`rejected`
  (`dispatch.ts:63-74`) — hence the **stale-finished-shadow** nuance.
- **`packages/server/src/pipelineService.ts:166-171`** rejects a 2nd *concurrent* human START of a
  singleton (`maxInstances:1`) with `rejected:'already_running'` (HTTP 409). All three input agents
  (`qualifier`/`triage`/`sorter`) are singletons. So two scans *at once* are already prevented; the
  user's "two at once" are two *sequential finished* scans.
- **`packages/react/src/boardModel.ts:17-21`** keeps an input agent visible forever (the "pipeline
  root") → finished scans accumulate. **`pipelineModel.ts:62-63`** `view()` relabels any
  kept-but-not-active instance to `running` → a finished root reads **"Working"**, while the big
  type card (`aggregate.ts`) correctly reads **"Done"**.
- **Effects** are bound **per-agent inside each workflow** (`apps/inbox/workflows/*/server.ts` →
  `ServerBinding.effects: Record<string, EffectFn>`) and resolved at approval as
  `runtime?.effects?.[gate.toolName]` (`pipelineService.ts:243`). **No cross-workflow collision.**
- **Renders/HITL** are merged on the **client** into ONE flat list **deduped by bare `toolName`**
  (`apps/inbox/client/src/workflows.ts:16-25`, the `byName` filter). Two workflows registering the
  same tool name with **different** components → only the first wins, the second is **silently
  dropped**. Latent collision (today masked because reuses are identical components).
- **No markdown rendering anywhere** (`grep` for markdown/remark/dangerouslySetInnerHTML = empty).
  Assistant text is raw `{msg.content}` (`AgentModal.tsx:118`); card reason text likewise → literal
  `**bold**` shows.
- **ActivityPanel** (`packages/react/src/components/ActivityPanel/ActivityPanel.tsx`) renders events
  **oldest→newest (newest at the BOTTOM)** and auto-scrolls to the bottom (lines 16-18, 130-146).
- **SourcePanel does not exist.** The approval card (`ApprovalDialog`) shows only the draft body;
  the untrusted source email is nowhere, though the data is already plumbed (`WorkItem.source`,
  `Gate.proposedArtifact`). (Per the 2026-06-13 architecture-analysis Notion page: the single
  unbuilt prompt-injection defense + the daily human-oversight surface.)

---

## 2. Work-streams (decisions LOCKED)

### WS1 — Re-run semantics (the headline)

**What the manager experiences.** One **current** scan per workflow in the live Pipeline column.
Pressing START again re-scans; the new scan becomes current and the prior finished scan **moves to a
Done/history bucket** (still openable, still human-closable) instead of stacking. Per-item cards
(emails/tickets) the scan surfaced **persist** as durable work items until the human closes them,
independent of which scan surfaced them. Mental model: refreshing an inbox.

**Decisions (locked):**

1. **Scan = refresh/supersede.** A human START retires the prior *finished* scan root of the same
   `workflow × input-agent` into the Done/history bucket (preserve, don't destroy — I12 guard-rail),
   and the new scan becomes current. Concurrency unchanged: a 2nd concurrent START of the singleton
   input still 409s (`already_running`); refresh is about the *sequential* re-run.
2. **Supersede routes through `transition()`** (I8). Add a terminal-preserving edge — recommended
   `close` (`finished | result → closed`) — and a `resolution`-style marker (e.g.
   `superseded`) so the Done bucket can label it; OR reuse the existing `closed` status (already in
   the `work_item_status` enum, `db/schema.ts`) with a `superseded` resolution. **Pick `closed`
   status + `resolution:'superseded'`.** Do NOT cancel children: the prior scan's per-item work
   items stay live/durable on their own.
3. **Item-level dedup scoped to OPEN items** (fixes stale-finished-shadow). Change the dedup SELECT
   in `dispatch.ts` so it matches only **non-terminal/unclosed** work items (still
   `queued|running|awaiting_approval|awaiting_input`, or `finished` whose result the human hasn't
   closed) — NOT a stale `closed`/superseded item. A fresh re-scan can then re-surface an
   un-actioned item whose prior processing finished; the **`workItemId+gateId` effect ledger (I9)**
   remains the real guard against any double irreversible action. Keep the existing `error`/
   `rejected` exclusion (explicit re-run).
4. **Fix the "Working" mislabel.** In `pipelineModel.ts` `view()`, only relabel a parent to
   `running` when it has a **live** child; a finished/closed root with no live child shows its true
   status (`done`). A superseded (closed) root drops out of the live column via `boardModel.isVisible`.
5. **Per-workflow knob, declared now, only `refresh` wired.** Add `rerun?: 'refresh' | 'history'`
   to `WorkflowDescriptor` in `@atizar/core` (config-as-data, I7), default `'refresh'`. Wire only
   `'refresh'` behavior in the beta (all three inputs are live-source scans). `'history'` (Option 2,
   no auto-supersede, finished scans all kept in the Done bucket) is reserved — leave a clearly
   commented branch point, do not implement it.
6. **Done/history surface = reuse what exists.** Superseded scans remain in the **Activity log /
   trace** (already records every event) and in a lightweight "previous scans" affordance on the
   workflow — do NOT build a heavy new `DoneDrawer` for the beta. The bar is: the human can still
   find and open a superseded scan; it is not destroyed.

**Files:** `packages/core/src/defineWorkflow.ts` (the `rerun` field + type), `transition.ts` (the
edge + resolution), `dispatch.ts` (open-scoped dedup + supersede-prior-root call), `pipelineService.ts`
(invoke supersede on a human START of an input agent before minting the new root),
`boardModel.ts` (`isVisible`: hide `closed`/`superseded` roots), `pipelineModel.ts` (`view()` fix),
`aggregate.ts` (verify Done still reads right). Tests: `dispatch.test.ts`, `transition.test.ts`,
`pipelineService.test.ts`, `boardModel`/`pipelineModel` unit tests.

**Acceptance:** (a) two sequential STARTs of `email-inbox` leave exactly **one** `EMAIL SORTER` row
in the live column (the latest), labeled correctly (`Working` while running, `Done` when finished —
never a finished root showing `Working`); the prior scan is still reachable in Activity/history;
(b) an un-actioned email from scan #1 is NOT duplicated by scan #2 (open-scoped dedup), and an
already-approved/sent email is never double-sent (effect ledger); (c) all three workflows behave per
`rerun:'refresh'`; (d) green gate + browser-verified.

### WS2 — Render/HITL registry scoping per workflow

**Problem.** The client render/HITL registry is flat-global-by-`toolName`; two workflows wanting the
same name → different component collide (silent drop). Effects (server) are already per-agent and
safe.

**Decision (locked):** scope the **client** render/HITL resolution by **workflow** (the natural
boundary, matching how the server scopes effects per agent-runtime). Concretely: `RenderSpec`/
`HitlSpec` carry their `workflowId` (or the registry becomes `Record<workflowId, RenderSpec[]>`),
and `AgentModal`/`buildRenderToolCall` resolve a tool's component by **(workflowId, toolName)**, not
bare `toolName`. The work item already carries `workflowId` (it's the `wf__agent` prefix), so the
lookup has what it needs. `@atizar/react` stays **workflow-agnostic** (no card knowledge; still a
userland-injected map — just keyed by workflow). Drop the global `byName` dedup in
`apps/inbox/client/src/workflows.ts` (dedup *within* a workflow only).

**Secondary (optional, same WS):** add a typed tool-name constant per workflow (a small `as const`
object, not a global enum) for typo-safety + autocomplete. This is additive and does NOT replace the
scoping — scoping is the fix, the constant is ergonomics. Skip if it balloons scope.

**Files:** `packages/react/src/*` (the `WorkflowsConfig` render/HITL types + `AgentModal` /
`buildRenderToolCall` / `ThreadModal` resolution by `(workflowId, toolName)`),
`apps/inbox/client/src/workflows.ts` (per-workflow keying, drop flat `byName`), each workflow's
`client.ts` (unchanged shape if `workflowId` is injected by the aggregator). Tests: a unit test that
two workflows registering the same tool name with different components both resolve correctly.

**Acceptance:** a synthetic test (two workflows, same tool name, different component) resolves each
to the right component; no console collision; existing cards still render; green gate + browser-verify.

### WS3 — Markdown rendering (+ prompt tightening)

**Decision (locked):** render markdown in (a) the assistant text bubble (`AgentModal.tsx:118`) and
(b) card free-text reason fields (e.g. the VerdictCard reason). Use **`react-markdown` + `remark-gfm`**
(safe, no `dangerouslySetInnerHTML`; standard, small) constrained to a **safe inline+block subset**:
bold, italic, lists, inline code, links (links `rel="noopener noreferrer" target="_blank"`), code
blocks, paragraphs. **No raw HTML** (do not enable `rehype-raw`). Wrap in a tiny `<Markdown>`
primitive in `@atizar/react` so every surface uses one constrained renderer.

**Secondary (userland):** tighten the agent prompts so the model does **not** restate structured
fields (Category/Priority/Reason) as markdown prose when those already render as card chips — the
structure lives in the card, the bubble should be a short sentence. Edit the relevant
`apps/inbox/agents/*.prompts.ts`. Keep markdown rendering anyway (general correctness).

**Files:** new `packages/react/src/primitives/Markdown/Markdown.tsx` (+ `.module.scss`), used by
`AgentModal` + the cards; `package.json` deps (`react-markdown`, `remark-gfm`);
`apps/inbox/agents/*.prompts.ts` (prompt tightening). Tests: a unit test that `**x**` renders a
`<strong>` and that raw HTML is escaped/neutralized.

**Acceptance:** the screenshot case renders bold/list correctly (no literal `**`); a raw-HTML/script
string in agent text renders inert (no injection); green gate + browser-verify.

### WS4 — Activity monitor: newest-first

**Decision (locked):** flip the Activity feed (operator mode) to **newest at the TOP**; auto-follow
pins to the **top** (new events push down) instead of the bottom. Keep the Trace (dev) grouped view;
within a group keep chronological (#1..#n) — only the **operator feed order** flips. Add a one-line
visual cue if cheap (e.g. "newest first"), else just the order. No other redesign (the architecture
analysis rated the trace itself "done well").

**Files:** `packages/react/src/components/ActivityPanel/ActivityPanel.tsx` (reverse the operator
`list` render order; invert the auto-follow scroll target + the `onScroll` pin threshold). Tests: a
unit/render test asserting newest-first order in operator mode.

**Acceptance:** newest event appears at the top and stays in view as events arrive; scrolling down to
read history pauses auto-follow; green gate + browser-verify.

### WS5 — SourcePanel + trust hardening

**Decision (locked):** build the **SourcePanel** — render `WorkItem.source` / `Gate.proposedArtifact`
(the untrusted source email/ticket) **next to the editable draft in the approval card**, visually
flagged as **untrusted external content** (a labeled, muted container). This is the
prompt-injection defense and the daily human-oversight surface; the data is already plumbed
(`serverTypes.ts` `WorkItem.source`, `Gate.proposedArtifact` via `useGate`/`routes.ts`).

**Adjacent (same WS, all reinforce I1 — include if they stay small; each is independently shippable):**

- **Show the incoming user-turn in the thread.** `AgentModal` renders only assistant messages; show
  the seed/source turn so the human sees what the agent reacted to. (Strengthens SourcePanel.)
- **SSE reconnect chip on the two important streams.** `useWorkItemThread` + `useBoard` lack
  error/reconnect state (a dropped stream looks frozen-but-live → the human could approve against a
  stale view). Mirror the already-built `useActivity` pattern: on `error` → `reconnecting` +
  re-prime snapshot; on `open` → `live`; show a "reconnecting…" chip in `ThreadModal` + board chrome.
- **Durable, attributed audit.** The human-readable audit is an in-memory 200-entry ring buffer
  (`activity.ts`, restart wipes it). Persist approval/effect/resolution to an append-only audit
  table (or a durable view over the lossless trace ⋈ gates), stamping `resolvedBy` (connection /
  `'shared-token'`); keep the ring buffer as the live UI tail only.

**Sequencing within WS5:** SourcePanel FIRST (highest leverage, mostly client, data ready), then the
three adjacent items in the order above. The adjacent items may each be split into their own small
plan if the implementing agent prefers; SourcePanel is the must-ship.

**Files:** new `packages/react/src/components/SourcePanel/*` used in the approval card;
`AgentModal`/`ThreadModal` (user-turn render); `useWorkItemThread.ts` + `useBoard.ts` (reconnect
state, mirroring `useActivity.ts`); server audit table + `activity.ts` (durable audit) +
`routes.ts`/`pipelineService.ts` (write audit rows on resolve/effect). Tests per piece.

**Acceptance:** at an approval gate the human sees the original untrusted email beside the draft,
clearly marked untrusted; a dropped SSE shows "reconnecting…" not a frozen-live thread; an approval
is recorded in a durable audit with an actor; green gate + browser-verify (esp. the HITL approval
flow with SourcePanel visible).

---

## 3. Recommended build order

Independent enough to parallelize, but the recommended **sequential** order (small/low-risk →
structural) for the autonomous run, each its own branch off `master`, each green-gated +
browser-verified + merged before the next:

1. **WS4** Activity newest-first (tiny, isolated warm-up).
2. **WS3** Markdown render (small, isolated; gives an immediate visible win).
3. **WS5** SourcePanel (high trust value; mostly client; data ready) — adjacent items after the panel.
4. **WS2** Render/HITL scoping (framework boundary; do before re-run touches the same client).
5. **WS1** Re-run semantics (largest, riskiest; touches dispatch/transition/board/pipeline + core).

Rationale: WS1 is the headline but also the biggest blast radius — doing the four smaller,
independent improvements first builds momentum and de-risks the shared client surfaces before the
structural change. If the implementing agent prefers WS1 first (it's the original ask), that's
acceptable — the WSes are independent — but keep WS2 before WS1 (both touch the client render path).

---

## 4. Cross-cutting requirements (apply to every WS)

- **Green gate before "done":** `yarn typecheck` && `yarn test` && `yarn lint` && `yarn format:check`
  && (`@atizar/react` change → `yarn build` of the package). Run from repo root.
- **Browser-verify EVERY user-visible flow** (project hard rule — see the `browser-verify` skill and
  the user's standing instruction). For WS1: two sequential STARTs + the label. For WS5: the full
  HITL approval flow with SourcePanel. Reload-masking bugs only the browser catches — do not skip.
- **TDD** (`superpowers:test-driven-development`): failing test → implement → green, for each unit.
- **Subagents must NOT switch git branches**; read history via `git show <sha>:path` / `git diff`;
  verify `git rev-parse --abbrev-ref HEAD` before finishing (CLAUDE.md rule).
- **Foundation:** WS1 and WS2 touch the foundation — the guard-rails in §0 are binding. If an
  implementation detail tempts past a guard-rail, STOP and re-read §0; do not erode I8/I12/I1/I5.
- **No cassette sharing** without the scan-and-warn ritual (CLAUDE.md) — not expected here, but if a
  cassette is touched, follow the rule.

---

## 5. Out of scope (explicit)

- The `'history'` rerun mode (Option 2 full DoneDrawer) — only the branch point is declared.
- Any GitHub/Magma-board mutation (hard read-only rule).
- Model-level prompt-injection classifier / sandbox / injection-eval (the analysis explicitly did
  NOT recommend it; SourcePanel + human oversight is the chosen defense).
- The "Revise/re-propose" gate edge and the `MAX_GATES` loop guard from the architecture analysis —
  related but separate tracks; note them in HANDOFF as future, do not build here unless trivial.
