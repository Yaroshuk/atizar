# Email-inbox workflow — design (2026-06-11)

The new flagship demo workflow, built BEFORE the packaging tail (7c) so the framework is
stress-tested by a real consumer: a new integration, machine dispatch, batch gates, multi-agent
interactions, and the UI/ops gaps a first external user would hit (credential health, prompt
hierarchy, primitives). Everything here goes through the public `@platform/*` packages only.

## 1. The workflow

```
EMAIL SORTER (input, singleton)
  reads unread emails from the last 24h (gmail-viewer list_unread, readonly),
  classifies each email, MACHINE-DISPATCHES children, renders a summary card:
    ├─→ REPLY      one child PER email needing a reply (maxInstances 2, overflow queues)
    │              fetches the full body itself (get_email, readonly), drafts a reply,
    │              saveDraft gate → human approves → SERVER creates the Gmail draft
    ├─→ READER     ONE child for the whole "informational" batch
    │              proposes mark-all-as-read; per-row overrides (trash / star / keep / → reply)
    ├─→ SPAM       ONE child for the suspected-spam batch — proposes trash-all, same overrides
    └─→ IMPORTANT  ONE child for the important batch — proposes star-all, same overrides
```

- **Machine dispatch, human action** (locked architecture: machine dispatch allowed / machine
  action never): the sorter dispatches children autonomously and visibly (they appear in the
  pipeline tree); no Gmail mutation ever happens without a human click on a gate.
- **All Gmail actions are server-executed effects**: markRead / trash / star / createDraft run
  on the server after gate approval, through the action ledger — exactly the step-4 model.
  (Existing `gmail.modify` OAuth scope covers all four.)
- **Re-routing between agents**: every batch row carries a "Draft reply" button = the EXISTING
  human-gated `deliver` seam (a click is the authorization — no gate needed for dispatch).
- **Email bodies never ride through the sorter model** (the step-"TRIAGE courier" lesson):
  `list_unread` returns metadata + snippet (enough to classify); dispatch payloads carry
  metadata only; REPLY fetches the full body itself via `get_email`.
- The existing `lead-inbox` and `github-triage` workflows stay (cross-workflow delivery still
  needs them); `email-inbox` becomes the README/demo flagship.

### Payloads

`EmailRef = { messageId, threadId, from, subject, date, snippet }` (zod schema in the workflow
descriptor). Reply child payload = one EmailRef; batch child payload = `{ emails: EmailRef[] }`.
Dedup `source`: reply child = `gmail:<messageId>`; batch child = `<agentId>:<sorted messageIds
joined>` — re-running the sorter over the same unread set dedups instead of double-dispatching.

## 2. New framework capabilities (the real deliverable)

### F1 — workflow-level prompt

`defineWorkflow` gains `prompt?: string` — shared context for every agent in the workflow
(tone, rules, "never narrate tool plumbing"). Composed at the binding seam (`buildProvider`
already threads `instructions`): final system prompt = workflow `prompt` + blank line + the
agent's strategy-built prompt. Agent prompts unchanged. This is also the future
`editableBy: manager` field for config-as-data (ARCHITECTURE §3).

### F2 — `dispatches` tool class (machine dispatch)

Fourth tool classification beside `readonly | approvals | renders` (the boot-time
classification kernel stays exhaustive — an unclassified tool still refuses to boot):

- `defineAgent.dispatches: string[]` (default `[]`, validated ⊆ `tools`).
- The sorter declares one dispatch tool: `route_emails({ to, emails: EmailRef[] })` — ONE call
  per child work item (a batch call carries N emails; a reply call carries 1). The model
  decides the grouping; the prompt instructs it.
- RunObserver detects a dispatch tool call in the stream (same place render tools are
  detected), validates `to` against the agent's `handoffs`, and calls the existing
  `pipelineService.deliver` with `parentId` = the current work item and `origin: 'agent'`.
  Invalid target → trace warning, no dispatch (model error, not a crash).
- Dedup, depth cap, pool cap: already the chokepoint's job — nothing new.
- The thread shows dispatch calls as chips in dev mode; the pipeline tree shows the children
  (that IS the visibility requirement).

### F3 — credential health ("the agent is disabled, here's why")

- Integrations export `checkCredentials(): Promise<HealthCheck>` (the `HealthCheck` type is the
  F9 thin contract; gmail-viewer + gmail-basic already ship the function — F9 retypes them).
- Providers get the same check (claude-cli: binary on PATH; mastra: `ANTHROPIC_API_KEY` set).
- `ServerBinding` gains optional `health?: () => Promise<HealthCheck[]>` per agent; the server
  runs all checks at boot AND on `GET /api/health`; the board snapshot carries
  `agentHealth: { [instanceId]: { ok, error?, hint? } }`.
- Boot does NOT fail (unlike the classification checks — missing creds is a USER state, not a
  programming error): the app starts, the affected agent renders greyed-out with a "missing
  credentials" badge; its START is disabled; the badge tooltip shows the `hint` (which points
  at the integration's how-to-use skill / doc).

### F4 — activity log (one place to see everything)

- Server: an `activity` EventBus topic + an in-memory ring buffer (last ~200 entries).
  Entries are minted at the seams that already exist: dispatch/deliver (item queued), run
  start, gate opened, gate resolved (approved/rejected + by which form), effect executed
  (summary), item finished/error/cancelled. Shape:
  `{ ts, workflowId, agentId, workItemId, kind, summary }`.
- Routes: `GET /api/activity` (snapshot) + SSE tail (same pattern as the board stream).
- Client: `ActivityLog` panel in `@platform/react` (opened from the global header), plain
  reverse-chronological list, auto-follow.

### F5 — global header + UI primitives

- **Header** (package component): workflow tabs (Chrome-tab styling — the current switcher
  restyled), a **Stop all** button (`POST /api/cancel-all` → `cancelWorkflow` over every
  descriptor), and the activity-log toggle button.
- **Primitives kit** in `@platform/react` (per the locked beta inventory): `Button`, `Card`
  (CardShell — head/title/kicker/badge/body/actions), `Badge`, `Tabs`, `Field`, `List`.
  Port of the existing Smedja CSS into reusable components — demo cards are rewritten on top
  of them as the worked example (cards stay userland).

### F6 — singleton START guard

Today an input agent with `maxInstances: 1` can be STARTed twice (the second queues —
confusing, not useful). Fix on both sides: the server rejects a human dispatch for an input
agent that already has an active instance (409, "already running"); the UI disables START
while `active ≥ maxInstances` (stats are already on the board payload).

### F7 — honest input-agent state in the pipeline

A finished input agent currently shows "Working" in the pipeline column. Fix in
`pipelineModel`/`statusDisplay`: a parent whose own run finished but has live children shows
**"Delegating"** (distinct from Working); a parent with no live children shows **Done**.

### F8 — junk narration

Primary fix is the workflow-level prompt (F1): "never narrate tool plumbing, no 'let me load
schemas' text". No client-side text filtering (hiding model text would mask real errors);
dev mode keeps showing everything raw.

### F9 — thin integration contract (decided 2026-06-11, build in this stage)

Today nothing structurally binds two integrations — gmail-basic/gmail-viewer share a SHAPE
(pure injectable fns, `{error}` returns, a `checkCredentials`, an MCP wrapper) only by the
discipline of the `write-integration` skill's prose. That is intentional at the heavy end
(belief #3: "no integrations catalog", thin contract + skills, NOT a base class), but two
things genuinely recur and deserve a TYPED contract so integrations stop being purely
"each its own thing":

- **`HealthCheck` type** — the `checkCredentials()` result shape
  (`{ ok: true; detail?: string } | { ok: false; error: string; hint: string }`), today hand-
  retyped per integration. Make it ONE exported type; `checkCredentials` implementations and
  the F3 health surface both reference it. This is the first shared integration contract type
  and the natural anchor for F3 (which collects health across integrations anyway).
- **A light result/classification convention, as TYPES not a base class** — name the recurring
  result shapes so consumers and the `ServerBinding` effect seam are uniform:
  `ReadResult<T> = T | { error: string }` and
  `BatchActionResult = { done: string[]; failed: { messageId: string; error: string }[] } | { error: string }`
  (gmail-viewer's `modify` already returns exactly this — lift it into the contract). The
  read/effect/health **classification** stays where it is enforced (I15 boot-time kernel +
  `defineAgent.readonly/approvals/effects`); F9 only adds the typed result shapes the functions
  return, it does NOT add a runtime registration step or a `defineIntegration()` wrapper (that
  would be the base-class the philosophy rejects).

**Placement (decide in the stage-2 plan, lean):** pure TS types → the contract home is
`@platform/core` (it is engine-free and React-free and already holds the public contracts), OR
a tiny shared `@platform/integrations` index if we want to keep node-batteries types out of
core. Recommendation: types in `@platform/core` (a new `integration.ts`, types only — no fs, no
googleapis), so userland's integration code imports the contract from the SDK like everything
else; `@platform/integrations` modules implement it. **No base class, no `defineIntegration`,
no runtime coupling — types only.**

**Docs/skills updated in THIS stage (not later):** the `write-integration` skill's "integration
contract (FACTS)" block references the typed `HealthCheck`/`ReadResult`/`BatchActionResult`
instead of describing them in prose; the gmail-viewer consumer skill's surface table points at
the shared types; gmail-basic + gmail-viewer `checkCredentials`/`modify`/read `.d.ts` are
retyped against the contract (no behavior change, byte-compatible); `docs/AGENTIC.md` records
the thin-contract decision under the integration track.

## 3. gmail-viewer integration (built VIA the new skill)

New integration `@platform/integrations/gmail-viewer` (gmail-basic stays untouched):

| function | kind | notes |
|---|---|---|
| `listUnread({ sinceHours })` | read | metadata + snippet per email, capped (~25) |
| `getEmail({ messageId })` | read | full decoded body (text part) |
| `markRead({ messageIds })` | effect | removes UNREAD label, batch |
| `trash({ messageIds })` | effect | `messages.trash`, batch |
| `star({ messageIds })` | effect | adds STARRED, batch |
| `checkCredentials()` | health | token file readable + a 1-unit API ping |

Same construction as gmail-basic: pure `.mjs` functions + `.d.ts`, injectable `getGmail`
client, `googleapis` optional peer, subpath exports, an MCP wrapper (for claude-cli) that
delegates to the pure functions, native Mastra tool registrations in
`apps/inbox/server/mastra/tools.ts` (read tools only — effects never reach the model).

**Two skills ship with this work (the agentic track, decisions A1/A5/A7):**

1. **`write-integration`** (dev skill, `.claude/skills/write-integration/`) — the staged
   procedure for authoring an integration: file layout, injectable client, optional peer,
   MCP wrapper + Mastra tool parity, `checkCredentials`, tests, subpath exports, embedded
   how-to skill, self-improvement stage (it's a Task skill per A9). gmail-viewer is built BY
   following it — the skill is validated by its first real run.
2. **`gmail-viewer` how-to-use/credentials skill** (consumer skill,
   `packages/integrations/skills/gmail-viewer/SKILL.md` per A7) — what the integration does,
   how to wire it into an agent (readonly tools vs effects), where credentials come from
   (`~/.gmail-mcp/` OAuth flow), what `checkCredentials` failures mean. The F3 health `hint`
   points here. This is the first consumer skill — A3's "after the contracts stabilize"
   condition is now met for the integrations contract.

## 4. The batch gate (per-row actions) — NO schema change

The reader/spam/important card looks like a list with per-row action selectors, but it maps
onto the EXISTING gate machinery unchanged:

- Gate `kind` stays `'approval'`; the **form** is
  `{ items: [{ messageId, from, subject, action }] }` where
  `action ∈ 'read' | 'trash' | 'star' | 'keep'`. The model proposes the batch default
  (reader → all `read`; spam → all `trash`; important → all `star`).
- The human edits per-row actions in the card (each toggle bumps local form state), then
  approves ONCE ("Apply N actions") — the edited form rides the existing
  formRev/ledger/resolve path verbatim. Reject = do nothing to any email.
- ONE server effect `applyEmailActions(form)` executes the rows (grouped into the three batch
  calls), **best-effort**: per-row failures are collected into the executed result
  (`{ applied, failed: [{messageId, error}] }`); the item only fails wholesale if every row
  failed. The resume prompt summarizes ("4 marked read, 1 trashed, 1 failed").
- A row's "→ Draft reply" button is NOT part of the form — it's the existing `deliver` seam
  (human-gated handoff to REPLY, dedup by `gmail:<messageId>`); the row flips to a "handed
  off" note via the existing derived-from-board mechanism.

`saveDraft` on REPLY is byte-identical to today's lead-inbox flow.

## 5. Agents (descriptor sketch)

```ts
sorter:    input,  maxInstances 1, readonly ['list_unread'], dispatches ['route_emails'],
           renders { renderSort: summary card }, handoffs ['reply','reader','spam','important']
reply:     worker, maxInstances 2, readonly ['get_email'],
           tools/approvals/effects/renders = today's reply agent (saveDraft → createDraft)
reader:    worker, maxInstances 1, approvals ['applyActions'], effects ['applyActions'],
           renders { applyActions: BatchCard }, handoffs ['reply']
spam:      worker, maxInstances 1, same shape as reader incl. handoffs ['reply']
important: worker, maxInstances 1, same shape as reader incl. handoffs ['reply']
workflow:  prompt = shared email-pipeline context + tone + no-plumbing-narration rule
```

The three batch agents share ONE card component (`EmailBatchCard`, userland) and ONE effect
implementation (`applyEmailActions`), differing only in prompt and proposed default — that's
deliberate (tests the framework's reuse story).

## 6. Build stages (each gets its own plan; one branch each)

1. **`write-integration` skill → `gmail-viewer`** (+ embedded consumer skill +
   `checkCredentials` on both gmail integrations). Pure integration work, no framework change.
2. **Core + server capabilities:** F9 thin integration contract (typed `HealthCheck` /
   `ReadResult` / `BatchActionResult` in `@platform/core`; retype the gmail integrations'
   `.d.ts` against it; update the `write-integration` + gmail-viewer skills + `docs/AGENTIC.md`
   to reference the types) — do this FIRST so F3 builds on the typed `HealthCheck`. Then
   F1 workflow prompt, F2 `dispatches` class + RunObserver dispatch + deliver wiring, F3 health
   checks + board exposure, F4 activity feed, F6 singleton guard, `POST /api/cancel-all`.
   Unit + conformance tests; both providers.
3. **The workflow itself:** descriptor/server/client modules, prompts (workflow + 5 agents),
   `EmailBatchCard` + sorter summary card, effects binding. Browser E2E on recorded cassettes:
   sort → 4-way dispatch → batch approve with edited rows → real Gmail markRead/trash/star;
   reply approve → real draft; re-route row → REPLY child; reject; Stop.
4. **React/UI:** F5 primitives + header + tabs + ActivityLog, F7 pipeline states, demo cards
   rewritten on primitives. Browser-verify every flow again through the new chrome.
5. **Polish + full-scenario E2E** with a fresh synthetic-ish cassette set; update HANDOFF,
   AGENTIC (skills as-built), CLAUDE.md (new gotchas), reword the draft-only line in HANDOFF
   ("draft-only" is the gmail-basic demo's scope, not a framework law — sending is legitimate
   gated future work, same clarification pattern as GitHub read-only).

Then the original packaging tail (API auth → DEMO=1 → eval → rename/README/LICENSE) proceeds
with email-inbox as the demo.

## 7. Testing

- Unit: defineAgent `dispatches` validation; route_emails → deliver mapping (fake observer
  run); batch-form effect grouping + best-effort semantics; health aggregation; activity ring
  buffer; prompt composition (workflow + agent).
- Conformance: dispatch-tool detection added to the provider conformance suite (both
  providers must surface the dispatch tool call as a normal TOOL_CALL so RunObserver sees it).
- Browser E2E (the only proof this codebase accepts): the stage-3 list above, driven on
  cassettes, with one forced-real run for the Gmail effects (then verified via Gmail API and
  cleaned up — un-trash, un-star, restore UNREAD where feasible).

## 8. Explicitly out of scope

- Sending email (legitimate future integration work — goes through gates like everything else;
  NOT in this workflow).
- Scheduled/inbound triggers (the sorter is started by a human; `origin: 'inbound'` stays
  reserved).
- Gate capabilities/expiry UI, approvals-queue view, notifications (post-beta list unchanged).
- Editing the workflow prompt from the UI (config-as-data lands later; the field is just data
  now).
