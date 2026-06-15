# Design — Cleanup → minimal demo → extensibility

**Status:** DRAFT for developer review (written autonomously 2026-06-15). Covers the whole NEXT
track from `HANDOFF.md`. Pairs with the implementation plan
`docs/superpowers/plans/2026-06-15-cleanup-minimal-demo-extensibility-plan.md`.

**Goal (developer's words):** trim the demo to ONE reference workflow so the code reads clean; kill
the magic strings and make prompts a reusable, readable part of the framework (not copy-paste per
workflow); add board cleanup (finished agents leave + Reset); re-check the library/userland boundary;
bring the client to house standards and write those standards down; record a fresh real-flow cassette;
and capture "how to add a workflow" as an `add-workflow` skill.

The reference workflow that survives is **email-inbox**.

---

## 0. Decisions made autonomously (confirm on return — easy to flip)

1. **`definePrompt` lives in `@atizar/core`** (no new package) — confirmed by developer.
2. **Identity is co-located in `prompts.ts`** (decided with developer — option B): the `definePrompt`
   block carries `identity`, and the descriptor references it (`instructions: replyPrompt.identity`).
   ALL of an agent's words live in one file (`prompts.ts`); the descriptor is pure structure. Still
   I7-legal — `instructions` is still a string on the AgentDefinition, just authored next to the turn
   scripts. The descriptor↔prompts import cycle is avoided by keeping payload schemas in `contracts.ts`.
3. **Provider prepends the composed instructions** (claude-cli), so `definePrompt`'s output is
   *turn-only* — no identity repeated in prose. This removes the dup AND fixes a latent Mastra double
   (it already used `instructions` as system while `buildFirst` also baked it in). Foundation-touching
   (provider contract) → gated by `check-foundation` + the conformance suite (I4).
4. **Tool/handoff/workflow-id names come from consts everywhere**, including inside prompt prose
   (`Call ${t.get_email} …`) — single source of truth, as directed. A drift-guard test asserts every
   name mentioned in prose exists in the workflow's registry.
5. **Board:** finished agents — including input agents — leave the LIVE pipeline (revises the WS1
   "keep input root forever" decision; cards/results stay reachable in Activity/history, I12). Reset
   clears terminal items silently; clearing OPEN/awaiting-approval work needs an explicit confirm
   (I12). Full reset spans all workflows. `resetOnStart` knob defaults off.
6. **Task 5 folds into Task 2** — the client is already ~A- on `CONVENTIONS.md`; the one component nit
   (ReplyDraftCard) belongs to github-triage and disappears with Task 1. Task 5 becomes: keep
   email-inbox client clean + WRITE the new rules into `CONVENTIONS.md`.
7. **Task 6 is blocked** on Gmail OAuth (`invalid_grant`) — needs you to re-auth in a real terminal
   (device flow needs a TTY). Runs last and is partly manual.

---

## 1. The reusable prompt system (`definePrompt`) — the heart of the track

### Core addition (`@atizar/core`, pure / isomorphic / engine-agnostic, I3)

```ts
export interface PromptSpec<T> {
  identity: string                                        // who the agent is → the descriptor's instructions
  input?: z.ZodType<T>                                    // handoff payload schema; omit for input agents
  onInput?: (payload: T) => string                        // first turn WITH a decoded payload
  onStart: () => string                                   // first turn with NO payload (input start / fallback)
  onResume?: (result: Record<string, unknown>) => string  // after the human approves (server effect result)
}

// Returns the turn-only strategy PLUS the identity string (the descriptor reads `.identity`).
export function definePrompt<T>(spec: PromptSpec<T>): PromptStrategy & { identity: string }
```

`definePrompt` owns the boilerplate currently hand-written in every agent: `decodeHandoff`, the
input/no-input branch, and the resume wiring. Its `buildFirst`/`buildResume` return **turn-only**
prose; the agent's identity + workflow house-rules are prepended by the provider from
`ProviderConfig.instructions` (the already-computed `composeInstructions(workflow.prompt,
agent.instructions)`). The `identity` string is carried on the returned object purely so the descriptor
can reference it (`instructions: replyPrompt.identity`) — the strategy itself never re-emits it.

- `buildFirst(input)` = `input ? (decode → onInput(payload)) : onStart()`; falls back to `onStart()`
  when no payload decodes.
- `buildResume?` = `onResume ? (_args, result) => onResume(result ?? {}) : undefined`.

### Provider change (claude-cli)

claude-cli currently expects `buildFirst` to already contain the composed preamble (userland bakes
`compose(...)` into the strategy). Change: the claude-cli provider **prepends `config.instructions`**
to the turn prose (`instructions \n\n turnProse`); userland stops baking it. Mastra already uses
`config.instructions` as the Agent's system prompt and `buildFirst` as the turn — now correct (no
double) because `buildFirst` is turn-only. The mock provider is unaffected. The conformance suite
(`core/conformance.ts`) must prove both providers still agree.

### Userland after (flat, one block per agent, no nested factories)

```ts
// workflows/email-inbox/prompts.ts  — ALL of the reply agent's words in one block
export const replyPrompt = definePrompt({
  identity: 'You handle one email that needs a personal reply. You propose a draft; the human approves.',
  input: ReplyPayloadSchema,
  onInput: ({ email }) => [
    `Email from ${email.from}, subject "${email.subject}".`,
    `1. Call ${t.get_email} to read the body.`,
    `2. Call ${t.renderLead} to surface it.`,
    `3. Call ${t.saveDraft} to propose the reply for approval (mandatory).`,
  ].join('\n'),
  onStart: () => 'No email was handed to you — tell the user to start from the Email Sorter.',
  onResume: ({ draftId }) => `Draft saved (id ${draftId}). Confirm in one short sentence.`,
})

// the batch shape is REUSE, not re-implementation:
const batchPrompt = (def: 'read' | 'trash' | 'star') => definePrompt({
  identity: 'You triage a batch of emails. You propose per-row actions; the human applies them.',
  input: EmailBatchSchema,
  onInput: ({ emails }) =>
    `You were handed ${emails.length} emails. Default action: ${def}. Call ${t.applyActions} once, ` +
    `one row per email; the human reviews and applies.`,
  onStart: () => 'No batch handed to you — tell the user to start from the Email Sorter.',
  onResume: ({ applied }) => `${applied} actions applied. Confirm in one short sentence.`,
})
export const readerPrompt = batchPrompt('read')
export const spamPrompt = batchPrompt('trash')
export const importantPrompt = batchPrompt('star')

// descriptor.ts — pure structure, identity referenced from the prompt block:
//   instructions: replyPrompt.identity,
```

Higher-level archetypes ("approval agent", "batch agent") deliberately **do NOT** go in core — they
know the vertical (I5). They live in userland and are documented by the `add-workflow` skill (Task 7).
Core gains only the generic shape; that keeps it "narrow by discipline."

---

## 2. Single source of truth for wire strings (extends WS6) — folds in Task 5

Per workflow (only `email-inbox` survives), every wire string is a named const; **never a TS enum**
(I7 — values stay serializable). Module layout that avoids the descriptor↔prompts import cycle:

- `contracts.ts` — payload Zod schemas (`ReplyPayloadSchema`, `EmailBatchSchema`, `EmailRefSchema`).
- `tools.ts` — tool-name consts (already exists; extend to cover `readonly` reads too).
- `ids.ts` — workflow id + agent ids + agent roles as consts (today raw: `id: 'email-inbox'`,
  `handoffs: ['reply', …]`, `role: 'input'`, `readonly: ['list_unread']`).
- `cards.ts` — card-name consts (already exists).
- `prompts.ts` — `definePrompt` blocks; tool names interpolated from `tools.ts`.
- `descriptor.ts` — structure only; `instructions: <agent>Prompt.identity` (identity authored in `prompts.ts`).
- `client/src/workflows.ts` — `scope(WORKFLOW_ID, …)` from `ids.ts`, not the literal `'email-inbox'`.

**Drift guard (new test):** every tool name appearing in any prompt's prose ∈ that workflow's
`tools.ts`; every handoff target ∈ the workflow's agent ids. This is what lets prose stay readable
while still enforcing the single source of truth.

**`CONVENTIONS.md` additions** (the standards that were missing): wire strings go through per-workflow
consts; prompts are authored with `definePrompt` (flat, turn-only); identity lives in the descriptor;
"structure → descriptor, words → prompts.ts" mental model; drift-guard test is mandatory for a new
workflow.

`@atizar/core` is NOT changed for typing depth (no generic over the tool-name union — explicitly
skipped per HANDOFF; the const discipline + drift test cover it).

---

## 3. Trim the demo to email-inbox only (Task 1)

Delete `lead-inbox` and `github-triage` and everything only they use; keep what email-inbox reuses.

**Delete:** `workflows/lead-inbox/`, `workflows/github-triage/`; `agents/qualifier.prompts.ts`,
`agents/triage.prompts.ts`, `agents/ticket.prompts.ts` (+ their `.test.ts`); `mcp/github-tools.mjs`,
`mcp/github-format.mjs` (+ `github-format.test.mjs`); github tool defs in `server/mastra/tools.ts` and
their entries in `server/providers.ts`; `eval/lead-inbox.eval.ts`, `eval/scenarios/lead-inbox.ts`;
the github-triage entries in the three aggregators (`workflows/index.ts`, `server/workflows.ts`,
`client/src/workflows.ts`); tests that reference the deleted workflows (`renderLead.test.tsx`,
`renderVerdict.test.tsx`, the lead/github blocks in `descriptors.parse.test.ts`,
`workflows.test.ts`, `agents/inbox.agent.test.ts`, `agents/github.agent.test.ts`).

**Keep:** `client/src/components/LeadCard`, `client/src/components/ApprovalDialog` (email-inbox reuses
them); `agents/reply.prompts.ts` content (migrates into `email-inbox/prompts.ts` under Task 2).

**Gotcha (must fix):** email-inbox currently relies on lead-inbox registering `renderLead`/`saveDraft`
first (client `workflows.ts` scopes lead-inbox before email-inbox; comment "already registered by
lead-inbox"). After the trim, **email-inbox must register `renderLead → LeadCard` and
`saveDraft → ApprovalDialog` itself** in `email-inbox/client.tsx`, or the reply agent's cards vanish.
Browser-verify the reply approval flow specifically.

**Done:** green gate + browser-verify email-inbox end-to-end (sort → reply draft approve → confirm;
batch approve).

---

## 4. Board cleanup (Task 3)

A product change to visibility + new Reset controls. Touches `@atizar/react` (board/pipeline models +
a ResetButton) and `@atizar/server` (a reset transition + routes). Respect I8 (status only via
`transition()`), I12 (hide, never silently destroy).

- **(a) Finished agents leave the live pipeline — including input agents.** Revise
  `boardModel.isVisible` (it returns `true` for any input root today) and `pipelineModel.buildPipeline`
  (it forces `x.isInput` into the `shown` set). New rule: an item is shown in the live column while it
  (or a descendant) is non-terminal; once terminal (`finished`/`closed`) with no active descendants, it
  leaves the live column. Its cards/result remain in Activity + the thread history (I12).
- **(b) Reset button** mirroring `StopButton`'s three layers (component → `useStopController`-style hook
  → server route). Scopes: per-workflow and global. Reset HIDES terminal items from the live board by
  driving a transition (reuse `supersede` → `closed`, or add a `reset` edge with a `resolution: 'reset'`)
  — never deletes.
- **(c) Full reset** = all workflows. **I12 boundary:** terminal items are cleared silently; if any
  OPEN/`awaiting_approval` items exist, the action requires an explicit `ConfirmDialog` ("This cancels N
  in-progress / awaiting-approval items") and, on confirm, cancels them via `transition('cancel')` then
  closes. Never silently discards un-closed human work.
- **(d) `resetOnStart?: boolean`** optional knob on `defineWorkflow` (I7), default off: at human START,
  clears that workflow's terminal items first. Complements `rerun: 'refresh'`.
- **START-button bug:** `aggregate.ts` counts `error` as active, so `aggregateLabel` is non-empty and
  hides START. Fix: START shows when there is no `running`/`awaiting_approval` instance — an `error`
  alone must not block a fresh START (show START alongside the error badge).

**Done:** green gate + browser-verify: scan finishes → input plate leaves the live column but its result
is in Activity; Reset (per-workflow + full) clears the board; an errored item still shows START; a full
reset with an awaiting-approval item prompts for confirmation.

---

## 5. Library/userland boundary re-audit (Task 4) — light

The boundary is already clean (the demo client is generic-free; `@atizar/react` carries the UI). Small
extractions only:

- Move the `scope()` aggregator helper from `client/src/workflows.ts` into `@atizar/react` (generic
  config-merge; any multi-workflow consumer needs it).
- Export `captureTool()` (the Mastra capture-tool helper, today inline in `server/mastra/tools.ts`) from
  `@atizar/server`.
- Document the thin stdio-MCP scaffold pattern (the surviving `mcp/gmail-tools.mjs` is the worked
  example) — as part of the `add-workflow` skill / a short note, not a new package.
- Re-confirm `@atizar/core` stays Node-free after `definePrompt` lands (it is — pure).

**Done:** green gate; no generic machinery left in `apps/inbox/` that a second consumer would
re-implement; `@atizar/react` build green.

---

## 6. Cassettes — record a real flow (Task 6) — BLOCKED, last, partly manual

Prereq (developer, real terminal): re-auth Gmail (`~/.gmail-mcp/` creds; the refresh token is expired,
`invalid_grant`). Then: wipe `apps/inbox/.cassettes/`, run a real email-inbox flow with
`DEV_RECORD_REPLAY=record` (or unset) to record one JSONL per `wf__agent`, then replay with
`DEV_RECORD_REPLAY=1`. **HARD RULE:** cassettes hold real captured email data — never commit/share
without the `scanCassette` ritual (warn + scan + report + wait for confirm). Also delete the stale WS5
test draft `r7666524379648912752` from Gmail Drafts.

**Done:** fresh cassettes recorded + replay verified in the browser; no cassette committed.

---

## 7. `add-workflow` skill (Task 7) — capstone

`.claude/skills/add-workflow/` documenting the clean, magic-string-free pattern the single email-inbox
reference establishes. Walks: `contracts.ts` (schemas + consts) → `prompts.ts` (`definePrompt` blocks)
→ `descriptor.ts` (structure: agents, roles, handoffs, connections, `rerun`/`resetOnStart`) →
`server.ts` (effects, allowed tools) → `client.tsx` (render/HITL specs, cards, registering own cards)
→ aggregator wiring (3 files) → tests (incl. the drift guard) → browser-verify. Depends on Tasks 1, 2,
4 being done (it documents their result).

**Done:** the skill exists, references real file paths from email-inbox, and a dry read-through shows a
new workflow could be built from it without re-deriving the boilerplate.

---

## Dependencies & parallelization

- **Task 1 (trim)** and **Task 3 (board)** are largely independent file areas → can run in parallel.
- **Task 2 (definePrompt + consts + CONVENTIONS / = Task 5)** needs Task 1's trimmed base (it only
  refactors the survivor + core); start after Task 1 merges, or coordinate on the shared aggregator/
  `agents/` files.
- **Task 4 (boundary)** can run after Task 1 (the MCP-scaffold note references the surviving gmail MCP).
- **Task 7 (skill)** is the capstone — after Tasks 1, 2, 4.
- **Task 6 (cassettes)** is last and gated on the developer's OAuth re-auth.

The implementation plan breaks each into independently-mergeable units with explicit ordering.

## Execution rules (unchanged from the 7-WS run; see HANDOFF.md)

One branch off `master` per task; subagents must NOT switch branches (read history via
`git show <sha>:path`). TDD: failing test → implement → green per unit. Green gate before "done":
`yarn typecheck && yarn test && yarn lint && yarn format:check` (+ `yarn workspace @atizar/react build`
for any react change). **Browser-verify every user-visible flow** (this codebase's bugs are
browser-only). Run `check-foundation` for Tasks 2 (core + provider contract), 3 (I8/I12), 4 (I3/I5) —
do not erode I1/I3/I5/I7/I8/I12. Merge to `master` directly (no PR — beta); delete the branch; update
`HANDOFF.md`.
