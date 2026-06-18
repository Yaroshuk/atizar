# Agent-to-Agent Return Channel — Core Design (Pass 1)

**Status:** Design approved in brainstorming (2026-06-18). Supersedes the return-channel portions of the
stale `tmp/feature-delivery-plan-docs` branch (written 2026-06-15, before the lifecycle-unify
Phase/Outcome split and the keyed-instance refactor — both now BUILT & LOCKED). `check-foundation`
is run at the **start of implementation** (this touches I3/I4/I8 — the closest the design comes to
changing a protected invariant); the developer has already consciously chosen to build the honest
return channel ("candidate #2"), so the skill run keeps it honest, not re-litigates it.

**One-line goal:** An agent, mid-task, asks another agent a question through a hub, **suspends**, and
**wakes with the answer** — an honest, server-authoritative, bounded, auditable request-response
channel. This Pass 1 ships the **isolated core primitive** proven on a minimal two-agent harness
(mock + claude-cli). The real `feature-delivery` workflow rides on top later (Pass 2).

---

## 0. What this is and isn't (the deliberate "candidate #2")

Today the work-item lineage is a **shallow acyclic tree** with a one-way waterfall: an agent dispatches
a child and forgets it; results never flow back over a live channel. The two-way pattern was
consciously deferred, not rejected (`pipeline-model.md:263–264`; instance-model spec §157–162 already
earmarks "bidirectional ask" as the NEXT pass).

We are **not** building a free agent-to-agent mesh (the market analysis — Notion "Межагентные
взаимодействия", 2026-06-15 — shows free mesh gives ~17× error amplification vs ~4.4× under central
orchestration). We are building **Variant B**: two-way request-response **routed through a hub**,
server-mediated, with the human on every irreversible action. After this change we are a **tree of
lineage + a bounded, hub-routed request-response overlay** — not a waterfall (answers flow back), and
not a free graph (no direct agent-to-agent mesh).

**Two passes (build order, not scope reduction):**
- **Pass 1 (this spec):** one question → suspend → wake, with the honest contract and every guard.
  The data model is shaped for fan-out and re-entrancy from day one, but the harness exercises N=1.
- **Pass 2 (a later spec):** fan-out/join (N>1 outstanding questions), deep re-entrancy, the real
  `feature-delivery` workflow (orchestrator hub + knowledge agents), the UI surfacing of
  `awaiting_agent` + browser-verify, and a shared "blackboard" only if a concrete need appears.

---

## 1. The chosen shape (synthesis of "V2 separation" + "V3 contract honesty")

The real fork is **not** the resume *mechanism* (kill-and-re-prime for claude-cli, native snapshot for
Mastra, the `consume()` loop, the `ResumeOutcome` prompt/message/null branching) — that mechanism is
reusable for both human-gate-resume and answer-resume. The real fork is the resume **payload type**.

- **Reusing `GateResolution` for an agent answer is a patch** (an answer has no `gateId`, no
  `decision: 'approved'|'rejected'`, and `executedResult` means "what the SERVER executed", not "what
  an agent answered"). It would force an optional-field soup that every consumer must defensively
  branch on, and would break the moment we hit failure modes, provenance/audit, Mastra resume-value
  divergence, or fan-out.
- Changing a **provider contract** (`@atizar/core`) later means re-touching BOTH providers + the
  conformance suite + every call site again, under another `check-foundation`. Doing it once, now,
  while we are already in there, is strictly cheaper.

**So we take:**
- From "V2": a **separate** signal (`AGENT_QUESTION`), a **new phase** (`awaiting_agent`), **new edges**
  (`ask`/`answered`), the gate stays **human-only**, and the **hub routing is workflow policy (app)**.
- From "V3": an **honest discriminated-union resume payload** (`{kind:'gate'} | {kind:'answer'}`) and a
  sibling prompt-building hook.
- **We do NOT take from "V3":** a second parallel resume execution path or a dedicated answer-delivery
  transport. The answer rides the **same rails** the human approval already rides (find the suspended
  item → wake it). Only the *type of the note* is new. There is no capability we lose by not building
  the duplicate machinery.

---

## 2. Two standing invariants this design is built around

**Single source of truth (one derivation per concept).** "Am I waiting for an answer?" is exactly the
work-item **phase `awaiting_agent`** in Postgres — and nowhere else (no parallel in-memory map that can
drift). "Is this question pending / answered / failed / timed out?" derives from the **one `questions`
row**. "How many rounds has this conversation had?" lives in **one place** (the question chain).

**Framework/workflow boundary (I5, physical).** The framework owns the **mechanism**: the signal, the
phase + edges, the `questions` record, the join/wake condition, the resume payload union, the bound,
the timeout/escalation. The workflow owns the **policy**: who the hub is, which agent answers which
target, the prompts, and the **tunable limits** (config-as-data). The framework carries **zero**
agent-id literals — a question's `target` is an opaque descriptor (like `Destination` in
`delivery.ts`) that a workflow-provided router resolves.

---

## 3. Components

For each: **[fw]** = framework package, **[app]** = workflow policy.

### 3.1 The question signal — `AGENT_QUESTION` **[fw, `@atizar/core`]**

New file `packages/core/src/question.ts`, mirroring `gate.ts`:

- `AgentQuestionValueSchema` — shaped for fan-out from day one:
  `{ questions: [{ toolCallId: string, target: <opaque>, payload: Record<string,unknown> }] }`.
  In Pass 1 the list has length 1.
- `target` is an **opaque destination descriptor** — the core does NOT know which agent it is; a
  workflow router resolves it (§3.7).
- `agentQuestion(value): CustomEvent` (factory) + `readAgentQuestion(event): AgentQuestionValue | null`
  (parser).

The asker calls a reserved ask-tool; the provider surfaces the call as `AGENT_QUESTION` and returns
(mirrors the approval kill-and-return in `claude-stream`).

### 3.2 Tool classes `asks` / `answer` **[fw, `defineAgent` / I15]**

- New `defineAgent` field `asks: string[]` (validated `⊆ tools`), parallel to `dispatches`. An ask-tool
  has distinct semantics ("suspend and receive an answer") from fire-and-forget `dispatches`, so it is
  its own I15 class — otherwise the boot-time I15 check can't catch an unclassified ask-tool.
- The answerer has a reserved `answer` tool (a **server-observed capture** — its args ARE the answer),
  classified symmetrically. The model never writes storage; the server writes the answer from the
  observed call.
- `defineAgent`'s `superRefine` gains the `asks ⊆ tools` check; the I15 boot classification gains
  `asks`.

### 3.3 New phase + edges **[fw, `lifecycle.ts` + `transition.ts`]** — *touches I8*

- New `Phase` value `awaiting_agent` (in the `Phase` union in `packages/core/src/lifecycle.ts` AND the
  `work_item_phase` pg-enum in `db/schema.ts`). This phase **is** the single source of truth for
  "waiting on an agent".
- New edges in `transition.ts` `EDGES`:
  - `ask`: `from: ['active'], to: 'awaiting_agent', outcome: 'running'`
  - `answered`: `from: ['awaiting_agent'], to: 'active', outcome: 'running'`
- `lifecycle()` classifies `awaiting_agent` as **live** (`isLive: true`) and **visible**
  (`isVisible: true`), like `awaiting_human`. `cancel` becomes legal from `awaiting_agent` too (a
  suspended asker must be cancellable — I10).
- A drizzle-kit migration adds the enum value.

### 3.4 The `questions` record — the single asker↔answerer link **[fw, `@atizar/server` / DB]**

New table `questions` — the **only** link between asker and answerer (NOT a deep `parentId` chain, so
the lineage tree stays shallow and re-entrancy can't blow the depth cap):

```
questions (
  id                 uuid pk,
  asker_work_item_id uuid not null,     -- who is suspended
  answerer_work_item_id uuid,           -- the dispatched answerer (null until dispatched)
  tool_call_id       text not null,     -- correlates to the asker's ask-tool call
  target             jsonb not null,    -- the opaque destination descriptor (app resolves)
  question_payload   jsonb not null,
  answer             jsonb,             -- filled when answered
  status             text not null,     -- 'pending' | 'answered' | 'failed' | 'timed_out'
  round              integer not null default 1,  -- conversation-chain round counter
  retries            integer not null default 0,
  deadline           timestamptz,       -- timeout (precedent: gates.expires_at)
  created_at         timestamptz default now(),
  answered_at        timestamptz
)
```

- **Join without duplication:** the asker wakes when it has **no `pending` rows left** — the condition
  is computed from this one table. (Pass 1: always exactly one row; the shape already supports N.)
- **Flat re-entrancy:** the answerer is dispatched "sideways"; this row holds the link, so the tree
  does not deepen no matter how many hops a conversation takes.

New `stateStore` methods: `insertQuestion`, `getQuestion`, `getPendingQuestionsForAsker`,
`answerQuestion`, `failQuestion`, `getExpiredQuestions`.

### 3.5 The resume payload union **[fw, `@atizar/core` `providers.ts`]** — *touches I3/I4*

```ts
export interface GateResolution {
  kind: 'gate'                               // NEW discriminant
  gateId: string
  decision: 'approved' | 'rejected'
  form?: Record<string, unknown>
  comment?: string
  executedResult?: Record<string, unknown>
}
export interface AnswerResolution {
  kind: 'answer'
  answers: { target: unknown; answer: Record<string, unknown>; ok: boolean }[]
  allOk: boolean
}
export type ResumePayload = GateResolution | AnswerResolution

// generalized signature:
resume?(handle: ResumeHandle, payload: ResumePayload): AsyncIterable<BaseEvent>
```

- `PromptStrategy` gains a sibling hook `buildResumeFromAnswer?(answers): ResumeOutcome`, parallel to
  `buildResume`. Each hook stays simple (no union inside one hook).
- Both providers branch on `payload.kind`:
  - **mock** — `kind:'answer'` → yield text incorporating the answer(s).
  - **claude-cli** — `resumePromptFrom` builds the re-prime prompt via `buildResumeFromAnswer`; the
    fresh process gets the prior transcript + the answer.
  - **mastra** — `runner.resume(handle.runId, payload)` (native snapshot).
- The **conformance suite** (`packages/core/src/conformance.ts`) gains an answer-resume case proving
  the behavior is identical across mock + claude-cli (I4 — the contract did not leak).

The resume **mechanism** and the gate insert/resolve plumbing are reused unchanged — no second path.

### 3.6 Server orchestration **[fw, `runObserver` + `pipelineService`]**

- In `runObserver.consume()`, detect `AGENT_QUESTION` (mirror the `readGateOpened` path at the gate
  detection site): write the `questions` row(s) → `transition(db, askerId, 'ask')` →
  `publishStatus(askerId, 'awaiting_agent')` → for each question, ask the workflow router (§3.7) to
  resolve `target`, then dispatch the answerer **shallow** (via the injected `deliver`, seeded with the
  question through `encodeHandoff`), recording `answerer_work_item_id`. Record an audit entry.
- When an answerer **finishes** having emitted its `answer`: write the answer to its `questions` row
  (`status='answered'`) → if `getPendingQuestionsForAsker(askerId)` is empty →
  `transition(db, askerId, 'answered')` + `observer.resume(askerId, { kind:'answer', answers, allOk })`.
  The "answerer finished → resolve its question → maybe wake the asker" step is the
  inverse-of-dispatch propagation; it lives in `pipelineService`/`runObserver` (generic orchestration),
  reusing the existing `deliver`/`resume` seams.
- An answerer that finishes **without** emitting `answer` → `failQuestion(..., 'failed')` → the timeout/
  escalation path (§3.8) handles it (retry or escalate); never a silent drop (I12).

### 3.7 Routing = workflow policy **[app]**

A new server binding `resolveQuestionTarget(target, ctx) => answererAgentId` (parallel to `effects` /
`deliver`). Knowledge of "who the orchestrator hub is, which agent answers which target" lives in the
**app**; the framework only invokes the binding. The Pass-1 harness provides a trivial router
(`target` is an agent id, validated against an allow-list like `handoffs`).

### 3.8 Bounds, cycle protection, timeout/escalation **[fw mechanism, app values — config-as-data]**

- **Depth is the wrong knob for conversation length.** `DEPTH_CAP` stays a small structural
  runaway-spawn backstop; a back-and-forth conversation is a **bounded loop**, not deep nesting.
  Because the asker↔answerer link is the `questions` row (not `parentId`), conversation turns never
  deepen the tree.
- **Tunable limits are config-as-data**, declared on the workflow/agent, never hardcoded in prose:
  `maxQuestionRounds`, `questionTokenBudget`, `questionTimeoutMs`, `maxQuestionRetries`.
- **Cycle protection** = the per-chain `round` counter (single source: the question chain) + token
  budget + the `DEPTH_CAP` backstop; on exhaustion → escalate to a human (never an infinite loop).
- **Timeout** (the `deadline` on the row): on expiry, **retry** (re-dispatch the answerer) up to
  `maxQuestionRetries`; otherwise **escalate** — open a **human gate** on the asker (reusing the gate
  machinery: `insertGate` + `transition('gate')`) that says "agent X has waited on Y for N — your
  call". The asker stays safely suspended in `awaiting_agent` the whole time; nothing is dropped (I12,
  and I1 — the human can always intervene). Resolving the escalation gate either feeds a
  human-provided answer or tells the asker to proceed/abort.
- A reaper (`getExpiredQuestions` swept periodically and/or on relevant events) drives the timeout.

---

## 4. The minimal test harness **[app/test]** — TDD red-first

A toy two-agent workflow (`asker` + `answerer`) on the mock + claude-cli providers. Server-level tests
(PGlite), each written RED first:

1. Asker emits `AGENT_QUESTION` → asker phase becomes `awaiting_agent`; one `questions` row `pending`.
2. The answerer is dispatched **shallow** — assert the lineage depth did not grow beyond expectation.
3. Answerer emits `answer` → row `answered` → asker transitions `answered` (phase `active`) and resumes
   with the answer in the `{kind:'answer'}` payload → asker finishes.
4. Timeout: the answerer never answers → after `deadline` → an escalation **human gate** opens on the
   asker (and the retry-up-to-cap path before it).
5. Cancel: cancelling the suspended asker cascades / cleans its `questions` row + the answerer (I10).
6. **Conformance:** answer-resume behaves identically on mock AND claude-cli (re-prime carries the
   answer) — I4.

**Browser-verify is deferred to Pass 2.** Per the project's refined rule (feature = red-first
real-browser e2e; manual browser driving is for bug discovery), the Pass-1 core has **no
user-visible symptom yet** (`awaiting_agent` is not surfaced in the UI until Pass 2), so it is gated by
server-level + conformance tests. When Pass 2 surfaces `awaiting_agent` in the board/thread, that
increment adds real-browser screen tests and a browser-verify pass.

---

## 5. Foundation notes (`check-foundation` at the start of implementation)

- **I8 (single-owner transitions):** the new `ask`/`answered` edges extend the `EDGES` set; every
  status change still flows through `applyEdge()`/`transition()`. Compliant — re-affirm.
- **I3/I4 (thin core, contract doesn't leak):** generalizing `resume` to `ResumePayload` is a
  **contract** change in `@atizar/core`; both providers implement it and the conformance suite proves
  parity. The suspend/wake is server-authoritative; no engine feature enters the core.
- **I1 (human intervenes/approves):** the asker is always cancellable while suspended; on timeout the
  human is brought in via an escalation gate. No fully autonomous, unbounded conversation.
- **I2/I9 (machine proposes, server executes the irreversible exactly once):** the return channel
  performs **no consequential action** — it only routes a question and delivers an answer. The gate
  stays human-only; the only irreversible actions remain behind human gates + the ledger.
- **I10 (stop per item and per workflow):** cancel is legal from `awaiting_agent`; cancelling an asker
  cleans its outstanding questions and answerers.
- **I12 (no silent drops):** a failed/timed-out question retries or escalates — never silently
  abandons a suspended asker.
- **I15 (every tool classified):** the new `asks`/`answer` classes keep the boot-time check honest.

---

## 6. Trajectory + experience capture (where this grows)

- **`feature-delivery` rides on top.** The orchestrator becomes the hub (`resolveQuestionTarget`
  policy); the students/teachers knowledge agents are answerers; the coder is an asker. None of that is
  in this spec — Pass 1 stays the isolated primitive.
- **Pass 2** adds fan-out/join (N>1 outstanding), deep re-entrancy, the UI surfacing of
  `awaiting_agent` + browser-verify, and a shared blackboard only if a concrete need appears (YAGNI).
- **Skill co-evolution (AGENTIC directive #1):** as the primitive becomes real, update the
  `add-workflow` skill to teach wiring an ask/answer agent pair (the `asks`/`answer` tool classes, the
  `resolveQuestionTarget` binding, the tunable limits), and add a rule/skill for the return channel.
  Capture every reusable, workflow-neutral lesson in the same pass that introduces it — not as a
  follow-up.

---

## 7. Open items for the implementation plan (not blocking the design)

- Exact placement of the answerer-finished → resolve-question hook (a new step in `pipelineService`
  vs a callback in `runObserver` deps) — decide against the live code during plan writing.
- Whether the reaper is an interval sweep or event-driven (or both) — decide with the live
  `pipelineService` lifecycle in view.
- Whether `answer` capture reuses the existing `captureTool` seam verbatim — verify during the plan.
