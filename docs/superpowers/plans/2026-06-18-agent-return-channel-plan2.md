# Agent Return Channel — Plan 2 (Server Orchestration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire the server so an agent emitting `AGENT_QUESTION` suspends in `awaiting_agent`, the answerer runs, and the asker wakes with the answer — server-authoritative, bounded, auditable.

**Architecture:** Builds on Plan 1's core contract (`AGENT_QUESTION`, `asks` class, `awaiting_agent` phase + pg-enum, `ResumePayload` union, providers branch on `kind`). All state changes through the single `transition()`/`applyEdge`; the `questions` table is the single asker↔answerer link (NOT deep `parentId`); routing is a workflow binding (app). `check-foundation` = CLEAR (recorded in the SDD ledger).

**Tech Stack:** TypeScript, Zod, Hono, Drizzle + Postgres (PGlite in tests), AG-UI vocabulary, claude-cli/mastra/mock providers, Vitest, yarn-classic.

## Global Constraints

- English only. Prettier `semi:false`, single quotes, `trailingComma:"es5"`, `printWidth:100`. ESLint green. **Run `yarn format:check` on touched files before each commit** (Plan 1 lesson: per-task `yarn test`+`typecheck` missed >100-col drift).
- **Single source of truth:** "waiting on an agent" = phase `awaiting_agent`; question state = the one `questions` row; round counter = one place (the question chain).
- **Framework/userland (I5):** routing (who answers) lives in the `resolveQuestionTarget` workflow binding; the framework carries opaque `target`, zero agent-id literals.
- **I8:** every status change through `transition()`/`applyEdge`; one `dispatch()` mints work items. **I2/I9:** the channel performs NO consequential action — only routes a question + delivers an answer; the only effects stay human-gated. **I10:** cancel legal from `awaiting_agent`. **I12:** timeout/failure → retry or human escalation, never a silent drop.
- **Tunables are config-as-data** (I7): `maxQuestionRounds`, `questionTokenBudget`, `questionTimeoutMs`, `maxQuestionRetries` declared on the workflow/agent descriptor, never hardcoded in prose.
- Commands from repo root with `yarn`. Stage specific paths, never `git add -A`. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Branch `feat/agent-return-channel` (continues Plan 1). The full server suite has ONE known pre-existing/parallel failure context: e2e lint (`apps/inbox/e2e/fixtures.ts`) + inherited format debt — NOT ours; controller owns the green-gate accounting at plan close.
- **Server-seam coordinates** (captured 2026-06-18; RE-VERIFY against live code before each task — they drift): runObserver `consume()` gate-detect ~213–232, `resume()` ~304, `AgentRuntime` ~26–44, `RunObserverDeps` ~46–75; pipelineService `resolveGate` ~333–479 (observer.resume ~475), `cancelItem` ~159–183; dispatch `DispatchInput` ~22–31, DEPTH_CAP=5; stateStore `insertGate` ~106, `claimLedger` ~164; recordReplay resume wrap ~186–219 (sig ~194); createServer AgentRuntime build ~120–128, `ServerBindingLike` ~30–36; transition `EDGES` ~46–65; schema `actionLedger` ~125, `auditLog` ~139.

---

### Task 1: `ask`/`answered` transition edges + `awaiting_agent` cancel

**Files:**
- Modify: `packages/server/src/transition.ts`
- Test: `packages/server/src/transition.test.ts` (add cases)

**Interfaces:**
- Produces: `Edge` gains `'ask' | 'answered'`; `EDGES.ask = { from:['active'], to:'awaiting_agent', outcome:'running' }`, `EDGES.answered = { from:['awaiting_agent'], to:'active', outcome:'running' }`; `EDGES.cancel.from` gains `'awaiting_agent'`.

- [ ] **Step 1: Write failing tests** — add to `transition.test.ts` (mirror existing edge tests; they use a PGlite/real-db helper — match the file's existing pattern for inserting a work item and asserting phase/outcome after an edge):

```ts
// ask: active -> awaiting_agent
it('ask suspends an active item into awaiting_agent', async () => {
  const id = await seedWorkItem({ phase: 'active', outcome: 'running' }) // use the file's existing seed helper
  await transition(db, id, 'ask')
  const wi = await getRow(id)
  expect(wi.phase).toBe('awaiting_agent')
  expect(wi.outcome).toBe('running')
})
// answered: awaiting_agent -> active
it('answered resumes an awaiting_agent item to active', async () => {
  const id = await seedWorkItem({ phase: 'awaiting_agent', outcome: 'running' })
  await transition(db, id, 'answered')
  expect((await getRow(id)).phase).toBe('active')
})
// ask illegal from terminal
it('ask is illegal from a terminal item', async () => {
  const id = await seedWorkItem({ phase: 'terminal', outcome: 'done' })
  await expect(transition(db, id, 'ask')).rejects.toThrow(/cannot "ask"/)
})
// cancel from awaiting_agent
it('cancel is legal from awaiting_agent', async () => {
  const id = await seedWorkItem({ phase: 'awaiting_agent', outcome: 'running' })
  await transition(db, id, 'cancel')
  const wi = await getRow(id)
  expect(wi.phase).toBe('terminal')
  expect(wi.outcome).toBe('stopped')
})
```

(Read `transition.test.ts` first and use its actual seed/get helpers — do not invent `seedWorkItem`/`getRow` if the file names them differently.)

- [ ] **Step 2: Run → FAIL** (`yarn test packages/server/src/transition.test.ts`): TS rejects `'ask'`/`'answered'` as `Edge`, and cancel-from-awaiting_agent throws IllegalTransition.

- [ ] **Step 3: Implement** in `transition.ts`: add `'ask'`/`'answered'` to the `Edge` union; add to `EDGES`:
```ts
  ask: { from: ['active'], to: 'awaiting_agent', outcome: 'running' },
  answered: { from: ['awaiting_agent'], to: 'active', outcome: 'running' },
```
and add `'awaiting_agent'` to `cancel.from`: `cancel: { from: ['queued', 'active', 'awaiting_human', 'awaiting_agent'], to: 'terminal', outcome: 'stopped' }`.

- [ ] **Step 4: Run → PASS**; `yarn typecheck`.
- [ ] **Step 5: Commit** `git add packages/server/src/transition.ts packages/server/src/transition.test.ts` → `feat(server): ask/answered transition edges + cancel from awaiting_agent`.

### Task 2: `questions` table + `questionStatus` enum + migration + stateStore methods

**Files:**
- Modify: `packages/server/src/db/schema.ts` (after `actionLedger`)
- Generate: `packages/server/src/db/migrations/0005_*.sql` (via `yarn workspace inbox db:generate`)
- Modify: `packages/server/src/stateStore.ts`
- Test: `packages/server/src/stateStore.questions.test.ts` (new)

**Interfaces:**
- Produces: `questions` table; `questionStatus` pgEnum `['open','answered','failed']`; `Question` row type; stateStore: `insertQuestion(input):Question`, `getPendingQuestionsForAsker(askerId):Question[]`, `answerQuestion(id, answer):void`, `failQuestion(id, reason):void`, `getExpiredQuestions(beforeMs):Question[]`.

- [ ] **Step 1: Failing test** `stateStore.questions.test.ts` (mirror `stateStore.audit.test.ts` boot: `runMigrations()` then exercise):
```ts
it('insert → pending → answer transitions a question', async () => {
  const asker = await store.insertWorkItem(/* a minimal queued item, mirror existing test */)
  const q = await store.insertQuestion({ askerWorkItemId: asker.id, target: { agentId: 'x' }, toolCallId: 'tc1', payload: { q: 'how?' } })
  expect((await store.getPendingQuestionsForAsker(asker.id)).length).toBe(1)
  await store.answerQuestion(q.id, { text: 'use X' })
  expect((await store.getPendingQuestionsForAsker(asker.id)).length).toBe(0)
})
it('failQuestion removes it from pending', async () => {
  const asker = await store.insertWorkItem(/* … */)
  const q = await store.insertQuestion({ askerWorkItemId: asker.id, target: {}, toolCallId: 'tc', payload: {} })
  await store.failQuestion(q.id, 'answerer crashed')
  expect((await store.getPendingQuestionsForAsker(asker.id)).length).toBe(0)
})
```

- [ ] **Step 2: Run → FAIL** (table/methods absent).
- [ ] **Step 3: Schema** — in `schema.ts` after `actionLedger`:
```ts
export const questionStatus = pgEnum('question_status', ['open', 'answered', 'failed'])
export const questions = pgTable('questions', {
  id: uuid('id').primaryKey(),
  askerWorkItemId: uuid('asker_work_item_id').notNull().references(() => workItems.id),
  answererWorkItemId: uuid('answerer_work_item_id'),
  target: jsonb('target').notNull(),
  toolCallId: text('tool_call_id').notNull(),
  payload: jsonb('payload').notNull(),
  status: questionStatus('status').notNull().default('open'),
  answer: jsonb('answer'),
  reason: text('reason'),
  round: integer('round').notNull().default(1),
  retries: integer('retries').notNull().default(0),
  deadline: timestamp('deadline', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  answeredAt: timestamp('answered_at', { withTimezone: true }),
})
```
- [ ] **Step 4: Generate migration** — `yarn workspace inbox db:generate` → verify a new `0005_*.sql` with `CREATE TYPE "question_status"` + `CREATE TABLE "questions"` and the `meta/_journal.json` update. Do NOT hand-edit generated files.
- [ ] **Step 5: stateStore methods** — mirror `insertGate`/`getOpenGate` patterns (use `db.insert(questions)…returning()`, `db.select().from(questions).where(and(eq(askerWorkItemId), eq(status,'open')))`, `db.update(questions).set({status:'answered', answer, answeredAt:new Date()})`, etc.). Export a `Question` type.
- [ ] **Step 6: Run → PASS**; `yarn typecheck`; `yarn test packages/server/src/stateStore.questions.test.ts`.
- [ ] **Step 7: Commit** `git add packages/server/src/db/schema.ts packages/server/src/db/migrations/ packages/server/src/stateStore.ts packages/server/src/stateStore.questions.test.ts` → `feat(server): questions table + stateStore CRUD (asker↔answerer link)`.

### Task 3: Widen the server resume seam to `ResumePayload` + answer-resume branch

**Files:**
- Modify: `packages/server/src/runObserver.ts` (`AgentRuntime`, `resume()` signature + branch), `packages/server/src/recordReplay.ts` (resume wrapper sig), `packages/server/src/createServer.ts` (wire `buildResumeFromAnswer`), `packages/server/src/pipelineService.ts` (the `observer.resume` call typing — no behavior change for the gate path).
- Test: `packages/server/src/runObserver.test.ts` (add an answer-resume case)

**Interfaces:**
- Consumes: `ResumePayload`, `AnswerResolution`, `PromptStrategy.buildResumeFromAnswer` (Plan 1, `@atizar/core`).
- Produces: `RunObserver.resume(id, payload: ResumePayload)`; `AgentRuntime.buildResumeFromAnswer?`; on `payload.kind==='answer'`, `resume()` builds the outcome via `runtime.buildResumeFromAnswer?.(payload.answers)` and flows through the same null/message/prompt branching as the gate path (the provider's `resume(handle, payload)` already branches).

- [ ] **Step 1: Failing test** — in `runObserver.test.ts` (mirror the existing gate-resume test), add: an agent in `awaiting_agent` with a fake runtime whose `buildResumeFromAnswer` returns `{kind:'message', text:'continuing with the answer'}` → `observer.resume(id, {kind:'answer', answers:[{target:{},answer:{text:'X'},ok:true}], allOk:true})` → the item finishes and a TEXT_MESSAGE_CHUNK with that text was appended to the trace. (Use the file's existing harness for building a runtime + asserting trace.)
- [ ] **Step 2: Run → FAIL** (resume types `GateResolution`; no answer branch; `buildResumeFromAnswer` not on runtime).
- [ ] **Step 3: Implement** — RE-READ the live `resume()` body first. Widen `resume(id, resolution: GateResolution)` → `resume(id, payload: ResumePayload)`. At the top, branch: when `payload.kind === 'answer'`, skip the `getOpenGate`/`resolveGateRow` block (no gate), compute `outcome = runtime.buildResumeFromAnswer?.(payload.answers) ?? null`, and pass `payload` to `provider.resume(handle, payload)` in the prompt arm; otherwise the existing gate path (`outcome = runtime.buildResume?.(args, payload.executedResult)`). The null/message/prompt outcome handling is SHARED — factor it so both arms reuse it (no duplicated block). Add `buildResumeFromAnswer?: PromptStrategy['buildResumeFromAnswer']` to `AgentRuntime`. In `createServer.ts` AgentRuntime build, add `buildResumeFromAnswer: b.prompts.buildResumeFromAnswer`. In `recordReplay.ts`, widen the wrapped `resume` param to `ResumePayload` (logic unchanged). In `pipelineService.ts`, the `observer.resume(wi.id, {...resolution, gateId, form, executedResult})` call now passes a `GateResolution` — add `kind: 'gate'` to that object for explicitness (the union's gate arm).
- [ ] **Step 4: Run → PASS**; full `yarn typecheck` (must stay green — this is the carry-forward that unblocks the answer payload reaching the providers).
- [ ] **Step 5: Commit** the touched files → `feat(server): widen resume seam to ResumePayload + answer-resume branch`.

### Task 4: `runObserver` detects `AGENT_QUESTION` → suspend + dispatch answerer

**Files:**
- Modify: `packages/server/src/runObserver.ts` (consume loop), `packages/server/src/createServer.ts` + `apps/inbox/workflows/.../server.ts` binding type (`resolveQuestionTarget`), `packages/core` if a `QuestionTarget`/binding type is needed (decide placement: the binding shape is generic → `@atizar/server`; the resolver impl is app).
- Test: `packages/server/src/runObserver.question.test.ts` (new)

**Interfaces:**
- Produces: in `consume()`, after the gate block, `const q = readAgentQuestion(event)` → for the (Pass-1: single) question: `store.insertQuestion({askerWorkItemId:id, target, toolCallId, payload})`, `transition(db,id,'ask')`, `publishStatus(id,'awaiting_agent')`, audit; resolve `target` via the injected `resolveQuestionTarget` → `deps.deliver({kind:'agent',agentId}, encodeHandoff(payload))` recording `answererWorkItemId`. New `RunObserverDeps.resolveQuestionTarget?: (target:unknown, ctx)=>{agentId:string} | null` and a `ServerBindingLike.resolveQuestionTarget?`.

- [ ] **Step 1: Failing test** — a fake provider whose `run` emits `agentQuestion({questions:[{toolCallId:'t', target:{agentId:'answerer'}, payload:{q:'?'}}]})` then returns; a fake `deliver` capturing dispatches; a `resolveQuestionTarget` returning `{agentId:'answerer'}`. Assert after the run: the asker is in `awaiting_agent` (via store), a `questions` row exists `pending`, and `deliver` was called once with `{kind:'agent',agentId:'answerer'}` + a handoff-encoded payload.
- [ ] **Step 2: Run → FAIL** (no question detection).
- [ ] **Step 3: Implement** — RE-READ the live consume loop + the gate-detect block. Mirror it for `readAgentQuestion`: insert the question row(s), `transition('ask')`, `publishStatus('awaiting_agent')`, set a flag (like `gateOpened`) so the loop ends the turn, then route+dispatch the answerer via `deps.deliver` (shallow: the answerer dispatches with `parentId = askerId` is acceptable for depth — but confirm DEPTH_CAP headroom; the question ROW is the wake-link, not the tree). Thread `resolveQuestionTarget` through `RunObserverDeps` and `createServer` (from the binding). Audit the question.
- [ ] **Step 4: Run → PASS**; `yarn typecheck`.
- [ ] **Step 5: Commit** → `feat(server): detect AGENT_QUESTION → suspend asker + dispatch answerer (hub-routed)`.

### Task 5: Answer propagation → wake the asker + `asks` wiring validation

**Files:**
- Modify: `packages/server/src/pipelineService.ts` (answerer-finish → resolve question → wake), `packages/server/src/runObserver.ts` (signal answerer-finish into pipelineService, or do it in the settle/finish path), `packages/core/src/defineAgent.ts` (already has `asks`), `packages/server/src/createServer.ts` (validation: an agent declaring `asks` MUST have `buildResumeFromAnswer`).
- Test: `packages/server/src/pipelineService.question.test.ts` (new) + a `createServer` validation test.

**Interfaces:**
- Produces: when an answerer work item finishes carrying an answer (Pass-1: take the answerer's surfaced result / final answer payload), `store.answerQuestion(qId, answer)`; if `getPendingQuestionsForAsker(askerId)` is empty → `transition(db, askerId, 'answered')` + `observer.resume(askerId, {kind:'answer', answers, allOk})`. A boot-time check in `createServer`: for each agent, if `def.asks.length > 0` and `binding.prompts.buildResumeFromAnswer` is undefined → throw (loud, like the I15 classification failure).

- [ ] **Step 1: Failing tests** — (a) end-to-end at the service level: seed an asker in `awaiting_agent` with one pending question + a dispatched answerer; drive the answerer to finish with an answer → assert the question is `answered`, the asker transitioned `answered`→active, and `observer.resume` was invoked with `{kind:'answer'}`. (b) `createServer` throws when an agent has `asks:['ask_x']` but no `buildResumeFromAnswer`.
- [ ] **Step 2: Run → FAIL**.
- [ ] **Step 3: Implement** — decide the answerer-finish seam against live code (a callback in `RunObserverDeps` invoked from the finish path, or pipelineService observing the answerer's terminal transition). Capture the answer (Pass-1: the answerer's `card`/final surfaced result; define precisely). Resolve + wake as above. Add the `createServer` validation. Bounds (round/budget) + timeout are Task 6.
- [ ] **Step 4: Run → PASS**; `yarn typecheck`.
- [ ] **Step 5: Commit** → `feat(server): answerer-finish wakes the asker with the answer; validate asks⇒buildResumeFromAnswer`.

### Task 6: Cancel cascade + timeout/escalation + bounds (config-as-data)

**Files:**
- Modify: `packages/server/src/pipelineService.ts` (`cancelItem` awaiting_agent branch; the reaper), `packages/core` (the tunable params on the descriptor — `maxQuestionRounds`/`questionTokenBudget`/`questionTimeoutMs`/`maxQuestionRetries` as declared config), the workflow descriptor wiring.
- Test: `pipelineService.question.test.ts` (add cases)

**Interfaces:**
- Produces: cancelling an asker in `awaiting_agent` fails its pending questions (and cancels live answerers via the existing cascade); a reaper over `getExpiredQuestions(now)` that, per the tunables, retries (re-dispatch up to `maxQuestionRetries`) else escalates by opening a HUMAN gate on the asker (reuse `insertGate` + `transition('gate')`); the round counter on the question chain bounds re-entrant asks.

- [ ] **Step 1: Failing tests** — (a) cancel an `awaiting_agent` asker → its pending questions become `failed`, answerer cancelled. (b) a question past `deadline` with `retries < max` → re-dispatched; with `retries == max` → a human gate opens on the asker (item phase `awaiting_human`). (c) round budget exhausted → escalation, never silent.
- [ ] **Step 2: Run → FAIL**.
- [ ] **Step 3: Implement** — `cancelItem` awaiting_agent branch (fail pending questions before the cascade). The reaper + tunables as config-as-data (declared on the descriptor, surfaced, NOT prose). Escalation reuses the gate machinery.
- [ ] **Step 4: Run → PASS**; `yarn typecheck`.
- [ ] **Step 5: Commit** → `feat(server): cancel cascade from awaiting_agent + timeout retry/escalation + bounds`.

### Task 7: End-to-end harness (mock) — full suspend→wake on the rails

**Files:**
- Create: a test-only two-agent workflow fixture (`asker` + `answerer`) — under `apps/inbox/workflows/` behind a dev/test flag, or a pure server-test fixture (decide against how the existing tests build a workflow).
- Test: `packages/server/src/returnChannel.e2e.test.ts` (new, PGlite)

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: a server-level e2e proving the whole loop: dispatch `asker` → it emits `AGENT_QUESTION` → `awaiting_agent` + pending question + answerer dispatched (assert lineage depth did not grow beyond expectation) → answerer answers → asker `answered`→active→finishes with the answer in its resume payload. Plus the cancel + timeout-escalation paths end-to-end.

- [ ] **Step 1: Write the e2e test** (the loop above, on the mock provider scripted to emit the question then, on answer-resume, emit a completion).
- [ ] **Step 2: Run → FAIL/iterate** until the full loop is green.
- [ ] **Step 3: Full green gate** — `yarn typecheck && yarn test && yarn lint && yarn format:check` (controller accounts for the known inherited e2e-lint/format debt — not this branch).
- [ ] **Step 4: Commit** → `test(server): end-to-end return-channel suspend→wake on the rails`.

**Plan 2 acceptance:** an agent emitting `AGENT_QUESTION` suspends in `awaiting_agent`, the answerer runs, the asker wakes with the answer and finishes; cancel + timeout→human-escalation work; everything audited + bounded; full server suite green (excluding inherited debt). Cross-provider (claude-cli cassette) + browser-verify of the `awaiting_agent` UI surface are **Plan 3 / Pass 2** (no UI symptom yet).

---

## Self-review notes
- **Carry-forwards from Plan 1 covered:** server resume seam widened (Task 3); `asks ⇒ buildResumeFromAnswer` validation (Task 5).
- **Single source of truth:** the wake decision reads `getPendingQuestionsForAsker` (one table); the resume-outcome null/message/prompt handling is factored once and reused by both gate and answer arms (Task 3) — no duplicated block.
- **I8/I2/I9/I10/I12:** edges via `transition()` (T1); no consequential action in the channel; cancel from `awaiting_agent` (T1/T6); timeout→escalation not silent (T6).
- **Re-verify coordinates:** every task RE-READs its live target file before editing — the line numbers above are a 2026-06-18 map and will drift.
- **`check-foundation`:** already CLEAR for Plan 2 (ledger). Re-run only if a task deviates from the suspend/wake-is-server-authoritative, no-consequential-action resolution.
