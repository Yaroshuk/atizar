# Design — Sorter scan result: server-authoritative counts + honest thread order

**Status:** design, agreed with the developer 2026-06-17. Builds on the instance model
(`2026-06-16-instance-model.md`) — same vocabulary (Agent / Instance / Run), same dedup-by-source,
same "safe re-scan" semantics. No protected-core surgery expected; it touches the dispatch-result
flow, the render-card contract, and **extends the trace with a server-injected `handoff` event** (same
class as the existing lifecycle note — consistent with I14, not a provider/AG-UI contract change), so
`check-foundation` runs during implementation (I8 / I14 boundary).

**Vocabulary (carried from the instance model):**

- **Run / scan** = one execution of the input (sorter) agent.
- **source** = the per-email dedup key (`email:{messageId}` / a batch's joined ids). One per email.
- **covered** = this source already has a live or finished (incl. stopped) Run — the existing
  `lifecycle().covers` policy. Re-dispatching a covered source is skipped (deduped).

---

## Problem

On a **re-scan**, the sorter's summary card reports numbers that don't match what actually happened.

Observed: an inbox of 6 unread emails was sorted; everything was stopped; one NEW `important` email
was added; START again. The framework correctly dispatched only the **1 new** email (the other 5 were
covered by source → deduped, no duplicate work). But the **INBOX SORTED card still showed
`reply 1 · reader 4 · spam 0 · important 1` (6 total)**, while the thread had **one** handoff note
(`→ Handed to IMPORTANT`). The card and the handoffs disagree.

**Two distinct defects, one root.**

1. **Counts come from the model, not the framework.** `renderSort` is a model render-tool; the model
   passes `counts` it computed by re-classifying the **whole current unread inbox** (`prompts.ts:29`,
   "counts is the number routed to each"). The emails are never marked read, so a re-scan re-reads all
   6 and the model honestly reports 6. Meanwhile dedup-by-source — a **framework-layer** fact at the
   dispatch chokepoint — silently drops 5 of the 6 dispatches. The model has no knowledge of dedup, so
   its count is the classification denominator (6), not the new-work denominator (1). **Two sources of
   truth for "what this scan did"** → they diverge on a re-scan. This violates single-source-of-truth
   and server-authoritative state (I8/I12).

2. **Handoff notes are positioned by layout, not by time.** `AgentModal` pins every `→ Handed to X`
   note to a fixed slot AFTER the whole trace (`AgentModal.tsx:231`), derived from board topology, not
   from the trace timeline. During streaming the trace is short, so a note sits right under the first
   bubbles — "reply before the report." As the report card + final text stream in ABOVE it, the note
   gets pushed down. Same note, never moved; the trace grew above it. The note's position relative to
   the report **flips between Working and Done.**

## Principle (the fix for both)

> **The model narrates; the framework accounts. The thread is one time-ordered stream.**

- Any **quantitative claim a card makes about what the system did** is a fact the framework owns
  (the dispatch chokepoint's per-route dedup outcome), not something the model self-reports. The model
  supplies prose; the numbers come from the server tally. (Generalizes the existing
  single-source / framework-vs-app separation rule; the counts card is its concrete case.)
- Everything shown in the thread is a **trace event positioned by its `seq`** — assistant text, tool
  calls, the server-injected lifecycle note, and a **handoff event** alike. Nothing is a board-derived
  afterthought floated into the stream by layout. The renderer walks one ordered list; it never decides
  position.

## Design — part 1: server-authoritative scan result

### The tally

**Boundary (I5 — checked):** the framework contributes ONE generic fact and zero email knowledge; the
email-specific projection lives entirely in the workflow.

- **Framework (`@atizar/server`) — generic.** When the RunObserver delivers a child for a dispatch
  tool-call, it already has the outcome. It emits the **generic `handoff` trace event** (part 2) into
  the parent's stream carrying `{ targetAgentId, childWorkItemId, deduped }`. No `reply/reader/spam/
  important`, no "email", no "scan" — just "a dispatch happened, to this agent, new-or-deduped." This
  single event serves BOTH parts (order + the new/deduped bit).
- **Workflow (`apps/inbox/workflows/email-inbox`) — policy.** The workflow READS its scan Run's
  `handoff` events from the parent trace and **projects** them into the email-specific scan result:

```ts
type ScanResult = {
  read: number // emails the scan READ this run (the model's input set)
  new: Record<Dest, number> // newly-dispatched work, by destination (deduped === false)
  alreadyHandled: Record<Dest, number> // covered-by-source, skipped this run (deduped === true)
}

```ts
type ScanResult = {
  read: number // emails the scan READ this run (the model's input set)
  new: Record<Dest, number> // newly-dispatched work, by destination (deduped === false)
  alreadyHandled: Record<Dest, number> // covered-by-source, skipped this run (deduped === true)
}
// Dest = 'reply' | 'reader' | 'spam' | 'important'
```

`read = Σnew + ΣalreadyHandled`. A batch route is ONE `handoff` event but N emails — the per-
destination number comes from the child's payload (`emails.length`), read app-side. The framework owns
the generic event; the **workflow** owns the numbers; the model contributes none of them.

### Window semantics (DECIDED — write it down, it's the easy-to-misread edge)

`alreadyHandled` is **the intersection of (what this scan READ now) ∩ (sources already covered)** — it
is **scoped to the current read collection, NOT cumulative.**

- The **read window** is rolling ("unread inbox, last 24h") and bounds what the model sees.
- **Dedup** is by `source` and persists in the work-item store (until Clear/reset), independent of the
  24h window.
- So an email that **ages out of the 24h window** simply leaves the report — it is neither `read`,
  `new`, nor `alreadyHandled` in the next scan. It's closed business; the card describes "your current
  inbox, annotated with what's already done," not a running ledger. `alreadyHandled` therefore shrinks
  as mail ages out — intended.
- Dedup still remembers aged-out sources: if one re-enters the window (e.g. marked unread again) it
  counts as `alreadyHandled`, never `new` — no duplicate work. Read-window and dedup stay consistent
  because the model dispatches only what it read, so dedup is never consulted for aged-out mail.

### The card

`SortSummaryCard` renders the `ScanResult` (server-fed), not model `counts`:

- **First scan (all new):** `Read 6 · 6 new this scan` + new chips `reply 1 · reader 4 · important 1`.
- **Re-scan:** `Read 6 · 1 new this scan · 5 already handled` + a `new:` row (`important 1`) and a
  muted `handled:` row (`reply 1 · reader 4`).

The model's `renderSort` keeps only the prose `summary` (one sentence). The `counts` arg is removed
from the contract (or accepted-and-ignored during migration); the prompt drops the "compute counts"
instruction so the model is no longer responsible for any number.

## Design — part 2: honest thread order (порядок вызовов)

### Call order (constraint, already satisfied)

For the server tally to exist when the card renders, the scan must **dispatch before it summarizes** —
`route_emails` calls precede `renderSort`. This is already the prompt's order (`prompts.ts:23` "Then
dispatch …", `:29` "Finally call renderSort"). Keep it as an explicit constraint: the summary card is
the LAST content the scan emits, after all dispatches, so the tally is complete.

### Display order — the structural fix (NOT a band-aid)

The instability is structural, not cosmetic: the thread mixes **two sources with no shared ordering**
— the trace (a time-ordered event stream, positioned by `seq`) and handoff notes (reconstructed from
board topology, positioned by **layout** in fixed slots). Any "hide the note until terminal" patch
treats the symptom; the next synthetic element re-introduces the same skew.

**Stable solution: one ordered timeline; a handoff is an EVENT on it.** A dispatch already happens at a
definite point in the parent scan's trace (the model's `route_emails` tool-call has a `seq`). Instead
of reconstructing a note from board topology and pinning it by layout, **the server emits a typed
`handoff` trace event into the PARENT's stream at that seq** — exactly the mechanism `settle` already
uses to inject the lifecycle "Done" note (`AgentModal.tsx:139` renders that system note as a banner).
The thread then renders by walking **one** ordered list: the handoff sits where it happened and
**never moves**, because it is anchored to a `seq`, not to a layout slot. No hiding, no jump — by
construction. Adding future synthetic elements stays stable for the same reason.

This converges with part 1: the **same `handoff` event** feeds both. Every dispatch emits one event
carrying `deduped`; the **count projection** reads all of them (new + deduped → the new/handled split),
while the **renderer shows a visible "→ Handed to X" line only for `deduped: false`** (a deduped route
handed nothing off new — it belongs in the card's handled tally, not as a timeline note). So the
visible handoff count equals `new` automatically. One source of truth (the chokepoint outcome), two
projections, never a second source (board topology) to disagree.

**Event payload (framework-generic):** `{ kind: 'handoff', targetAgentId, childWorkItemId, deduped,
ts }` — the target reference the UI needs for the "Open X" link, plus the `deduped` bit part 1 reads.
No workflow-specific fields.

**Testability requirement (this is WHY the fix matters, not just a side effect).** Today the thread
order depends on THREE inputs at once — board topology + layout-pinned slots + stream timing — so it
is not a pure function and only the browser catches a regression. The fix MUST collapse this to a
**pure projection** `events → ordered thread items` (a standalone function the renderer calls, not
logic tangled inside the React component). Once order is a pure function of one seq-ordered list:

- a **render/component test** feeds a fixed event list (`[text, handoff@seq, renderSort, text,
  lifecycle-note]`) and asserts the rendered element order — deterministically, no browser;
- the **streaming** progression is covered the same way by feeding a **prefix** of the list (events
  arrived so far) and asserting the handoff sits on its `seq`, never floated above the not-yet-arrived
  report. This is the exact "handoff before report" regression, now unit-coverable.

The browser pass remains (manual cross-check), but ordering stops being browser-only.

`received` is the symmetric case — the child's first trace event ("handed in from <parent>"), at
`seq 0` of the child's stream — so both directions come from the timeline, not from layout.

Rejected alternative — **gate the `sent` notes on terminal status** (hide while live, show at Done):
the minimal patch, but it leaves the two-source structure intact (notes still reconstructed from
topology and pinned by layout) and only suppresses the visible symptom during streaming. A band-aid,
not the fix.

## Rejected designs (record why — these are the tempting wrong turns)

- **Mark handled emails as read** (so a re-scan reads only new). Wrong layer + violates
  no-silent-mutation / draft-only: "handled by our pipeline" lives in OUR work items (source dedup),
  not in the user's Gmail read flag; flipping read silently mutates the mailbox and conflates
  "human read it" with "pipeline handled it."
- **Feed the model the already-handled set so it self-reports** the split. Re-introduces a second
  source of truth and asks the LLM to do arithmetic the framework already knows deterministically —
  fragile.

## Where it lands (RE-VERIFY live before trusting — paths drift)

- **Tally — split across the boundary (I5):**
  - **Framework (`@atizar/server`, generic):** `runObserver.ts` already calls `.deliver()` and holds
    the `{ deduped }` outcome — emit the generic `handoff` trace event there (see Display order). The
    framework adds NOTHING email-specific; it owns only the event.
  - **Workflow (`apps/inbox/workflows/email-inbox`, policy):** project the scan Run's `handoff` events
    (read from the parent trace; for a batch, count via the child's payload `emails.length`) into the
    email `ScanResult`. The destinations, `read`/`new`/`alreadyHandled` shape, and "Read N" wording all
    live here — never in `@atizar/server`.
- **Card data:** `apps/inbox/workflows/email-inbox/client.tsx:42-62` (`renderSort` spec — render the
  workflow-projected `ScanResult`, drop reliance on model `counts`),
  `apps/inbox/client/src/components/SortSummaryCard/` (render the new/handled split).
- **Prompt:** `apps/inbox/workflows/email-inbox/prompts.ts:29` — remove the "counts is the number
  routed to each" instruction; keep classify + dispatch + one-sentence summary. Keep dispatch-before-
  render order (`:23`/`:29`).
- **Contract:** `renderSort` parameters — `counts` removed (or accepted-and-ignored for migration);
  `summary` stays. Update `prompts.drift.test.ts` / the render-spec drift guard.
- **Display order (framework, both ends):**
  - `@atizar/server` RunObserver (`runObserver.ts`, where `.deliver()` resolves) — append a typed
    `handoff` event to the PARENT's trace stream, reusing the same trace-append / event-bus seam
    `settle` uses for the lifecycle note. Generic; no email-specific fields. Emitted for EVERY dispatch
    (carries `deduped`), so part 1 can read it.
  - `@atizar/react` thread render (`AgentModal.tsx`) — render a `handoff` event inline at its `seq`
    (alongside text / tool-calls / the lifecycle banner); show a visible "→ Handed to X" line only for
    `deduped: false`. **Delete** the board-topology reconstruction (`useBoardNavigation.notesFor`) and
    the layout-pinned `sent` / `received` blocks (`AgentModal.tsx:211-252`). The renderer no longer
    positions anything — order is the trace's `seq`.
  - **App** supplies only the display label / target name (already via `nameOf` / `labelOf`) and the
    card component — never ordering or positioning.

## Scope

- **In:** the sorter `ScanResult` (server tally + window semantics), the `SortSummaryCard` new/handled
  split, the `renderSort` contract trim, the prompt trim, and the **framework `handoff` trace event**
  (server emit + react inline render, deleting the topology-reconstructed layout-pinned notes).
- **Out:** marking mail read; any Gmail mutation; bidirectional ask; touching other workflows' cards
  (the principle is general, but only the sorter card is migrated here — other factual cards adopt it
  when each is touched).

## Execution rules (per project conventions)

- TDD per unit; green gate before "done": `yarn typecheck && yarn test && yarn lint &&
  yarn format:check` from repo root (+ `yarn workspace @atizar/react build` for any `@atizar/react`
  change).
- **Order is covered by a pure render test, not only the browser** (see the Testability requirement):
  a component/render test over the `events → ordered thread items` projection asserts both the full
  order and a streaming prefix (handoff anchored to its `seq`, never above the not-yet-arrived report).
- **Browser-verify every user-visible flow** (`browser-verify` skill): first scan, re-scan after Stop
  + one new email (the card must read `Read N · 1 new · K handled`, and the handoff count must equal
  `new`), and the streaming order as a manual cross-check.
- Run **`check-foundation`** before landing — the change touches the dispatch-result flow and shifts a
  card's quantitative content from model to server (I8/I12 boundary).
