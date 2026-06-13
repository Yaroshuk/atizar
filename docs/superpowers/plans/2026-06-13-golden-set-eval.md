# Golden-set eval harness + two step-6 follow-ups — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each workflow a deterministic, credential-free golden-set eval that runs its agents through the real `PipelineService` on committed synthetic cassettes and asserts the structural outcome (tree, gates, statuses, effects, cards); plus close the two step-6 follow-ups (observable 3-at-once cap; browser-verified cross-workflow handoff).

**Architecture:** An in-process eval harness builds a real `PipelineService` exactly as `apps/inbox/server/index.ts` does — but with `DEMO=1` (→ in-memory PGlite + the `demo` record-replay provider reading `apps/inbox/demo-cassettes/`) and with each agent's server effects replaced by credential-free fakes that LOG every call. Scenarios dispatch one entry agent, the harness drives the gate loop to quiescence, and tests assert on collected structural facts. The cap follow-up uses an injected blocking provider; the cross-workflow follow-up is a browser E2E.

**Tech Stack:** TypeScript, vitest, drizzle + PGlite (in-memory Postgres-in-WASM), `@atizar/server`, `@atizar/core`, the existing `record-replay.ts` `demo` mode.

---

## File structure

- `apps/inbox/eval/runner.ts` — harness: `buildEvalService()` + `runGolden(scenario)` + `RunFacts`/`GoldenScenario` types. The only non-trivial logic.
- `apps/inbox/eval/scenarios/lead-inbox.ts` — `GoldenScenario[]` for lead-inbox.
- `apps/inbox/eval/scenarios/email-inbox.ts` — `GoldenScenario[]` for email-inbox.
- `apps/inbox/eval/lead-inbox.eval.ts` — vitest file asserting lead-inbox scenarios.
- `apps/inbox/eval/email-inbox.eval.ts` — vitest file asserting email-inbox scenarios.
- `apps/inbox/eval/cap.eval.ts` — F1: blocking-provider cap scenario.
- `apps/inbox/demo-cassettes/lead-inbox__qualifier.jsonl` — new synthetic fixture.
- `apps/inbox/demo-cassettes/lead-inbox__reply.jsonl` — new synthetic fixture.
- `vitest.eval.config.ts` (repo root) — eval-only vitest config (`env.DEMO=1`, no Postgres globalSetup).
- `package.json` (root) — add `"eval"` script.

**Why a separate vitest config + `*.eval.ts` extension:** the default `vitest.config.ts` sets `env.DATABASE_URL` to the test Postgres and includes `apps/inbox/**/*.test.{ts,tsx,mjs}`. The eval needs `DEMO=1` set *before module load* (PGlite is selected at the top of `db/client.ts`). A distinct extension (`*.eval.ts`) keeps eval files out of the default `yarn test` run; `yarn eval` runs them under `vitest.eval.config.ts` with `env.DEMO=1`. CI runs both `yarn test` and `yarn eval`. (Deviation from the spec's "also picked up by `yarn test`" — process-global env can't be both Postgres and DEMO in one run; documented here.)

---

## Task 1: Synthetic lead-inbox cassettes

email-inbox already has its five committed cassettes; lead-inbox has none committed (only gitignored real ones). Author two synthetic share-safe cassettes mirroring the proven event shapes. The reply cassette mirrors `apps/inbox/demo-cassettes/email-inbox__reply.jsonl` (lead-inbox `reply` uses the same `renderLead` + `saveDraft` tools); the qualifier cassette emits one `renderVerdict` call + a short text.

**Files:**
- Create: `apps/inbox/demo-cassettes/lead-inbox__qualifier.jsonl`
- Create: `apps/inbox/demo-cassettes/lead-inbox__reply.jsonl`

- [ ] **Step 1: Write `lead-inbox__qualifier.jsonl`** (one JSON object per line, invented data only)

```
{"step":0,"event":{"type":"TOOL_CALL_START","toolCallId":"demo_q_verdict","toolCallName":"renderVerdict","parentMessageId":"demo-q-msg-1"}}
{"step":0,"event":{"type":"TOOL_CALL_ARGS","toolCallId":"demo_q_verdict","delta":""}}
{"step":0,"event":{"type":"TOOL_CALL_ARGS","toolCallId":"demo_q_verdict","delta":"{\"category\": \"sales\","}}
{"step":0,"event":{"type":"TOOL_CALL_ARGS","toolCallId":"demo_q_verdict","delta":" \"priority\": \"high\","}}
{"step":0,"event":{"type":"TOOL_CALL_ARGS","toolCallId":"demo_q_verdict","delta":" \"reason\": \"Sam is actively comparing pricing tiers — a warm inbound lead.\"}"}}
{"step":0,"event":{"type":"TOOL_CALL_END","toolCallId":"demo_q_verdict"}}
{"step":0,"event":{"type":"TOOL_CALL_RESULT","messageId":"demo-q-res-1","toolCallId":"demo_q_verdict","content":"Verdict surfaced to the user.","role":"tool"}}
{"step":0,"event":{"type":"TEXT_MESSAGE_CHUNK","role":"assistant","messageId":"demo-q-text-1","delta":"Qualified"}}
{"step":0,"event":{"type":"TEXT_MESSAGE_CHUNK","role":"assistant","messageId":"demo-q-text-1","delta":" as a high-priority sales lead."}}
```

- [ ] **Step 2: Write `lead-inbox__reply.jsonl`** (invented data; same structure as the email-inbox reply cassette — renderLead, saveDraft, GATE_OPENED, then a step:1 confirmation)

```
{"step":0,"event":{"type":"TOOL_CALL_START","toolCallId":"demo_r_lead","toolCallName":"renderLead","parentMessageId":"demo-r-msg-1"}}
{"step":0,"event":{"type":"TOOL_CALL_ARGS","toolCallId":"demo_r_lead","delta":""}}
{"step":0,"event":{"type":"TOOL_CALL_ARGS","toolCallId":"demo_r_lead","delta":"{\"from\": \"Sam Carter <sam@harborfreight.example>\","}}
{"step":0,"event":{"type":"TOOL_CALL_ARGS","toolCallId":"demo_r_lead","delta":" \"subject\": \"Question about your pricing tiers\","}}
{"step":0,"event":{"type":"TOOL_CALL_ARGS","toolCallId":"demo_r_lead","delta":" \"summary\": \"Sam is comparing the Starter and Growth tiers.\"}"}}
{"step":0,"event":{"type":"TOOL_CALL_END","toolCallId":"demo_r_lead"}}
{"step":0,"event":{"type":"TOOL_CALL_RESULT","messageId":"demo-r-res-1","toolCallId":"demo_r_lead","content":"Email surfaced to the user.","role":"tool"}}
{"step":0,"event":{"type":"TOOL_CALL_START","toolCallId":"demo_r_save","toolCallName":"saveDraft","parentMessageId":"demo-r-msg-2"}}
{"step":0,"event":{"type":"TOOL_CALL_ARGS","toolCallId":"demo_r_save","delta":""}}
{"step":0,"event":{"type":"TOOL_CALL_ARGS","toolCallId":"demo_r_save","delta":"{\"threadId\": \"demo-lead-thread-1\","}}
{"step":0,"event":{"type":"TOOL_CALL_ARGS","toolCallId":"demo_r_save","delta":" \"body\": \"Hi Sam,\\n\\nGrowth adds unlimited seats, advanced reporting, and priority support on top of Starter.\\n\\nBest,\\nThe team\"}"}}
{"step":0,"event":{"type":"TOOL_CALL_END","toolCallId":"demo_r_save"}}
{"step":0,"event":{"type":"CUSTOM","name":"GATE_OPENED","value":{"gateKind":"approval","toolName":"saveDraft","toolCallId":"demo_r_save","proposedArtifact":{"threadId":"demo-lead-thread-1","body":"Hi Sam,\n\nGrowth adds unlimited seats, advanced reporting, and priority support on top of Starter.\n\nBest,\nThe team"}}}}
{"step":1,"event":{"type":"TEXT_MESSAGE_CHUNK","role":"assistant","messageId":"demo-r-text-1","delta":"The"}}
{"step":1,"event":{"type":"TEXT_MESSAGE_CHUNK","role":"assistant","messageId":"demo-r-text-1","delta":" Gmail draft has been saved."}}
```

- [ ] **Step 3: Verify the fixtures are valid JSONL and scan-clean**

Run:
```bash
cd /Users/yaroshuk/Development/AiWorkflow
for f in apps/inbox/demo-cassettes/lead-inbox__*.jsonl; do while IFS= read -r l; do echo "$l" | python3 -c "import sys,json;json.loads(sys.stdin.read())" || echo "BAD: $f"; done < "$f"; done
yarn workspace inbox demo:scan-cassettes
```
Expected: no `BAD:` lines; `demo:scan-cassettes` reports clean (no findings) over the new files (reserved-TLD `.example` emails are exempt).

- [ ] **Step 4: Commit**

```bash
git add apps/inbox/demo-cassettes/lead-inbox__qualifier.jsonl apps/inbox/demo-cassettes/lead-inbox__reply.jsonl
git commit -m "test(7c-D): synthetic share-safe lead-inbox golden cassettes"
```

---

## Task 2: Eval vitest config + `yarn eval` script

**Files:**
- Create: `vitest.eval.config.ts`
- Modify: `package.json` (root) — add the `eval` script

- [ ] **Step 1: Create `vitest.eval.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

// Eval harness config — SEPARATE from vitest.config.ts because the eval runs in DEMO mode
// (in-memory PGlite + synthetic-cassette replay), set via env BEFORE any module loads. The
// default config wires the test Postgres + globalSetup, which the eval must not inherit.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    environment: 'node',
    globals: true,
    env: { DEMO: '1' },
    include: ['apps/inbox/eval/**/*.eval.ts'],
    // Eval scenarios share one in-memory PGlite per worker; keep a file's tests in-process
    // and serial (resetDb between them). Cross-file isolation is automatic (one PGlite per worker).
    fileParallelism: false,
    testTimeout: 60_000,
  },
})
```

- [ ] **Step 2: Add the `eval` script to root `package.json`**

In the `"scripts"` block, add:
```json
"eval": "vitest run -c vitest.eval.config.ts"
```

- [ ] **Step 3: Verify the config loads (no eval files yet → vitest reports no tests)**

Run: `yarn eval`
Expected: vitest starts, finds no test files matching the include, exits 0 (or "No test files found" — acceptable at this step).

- [ ] **Step 4: Commit**

```bash
git add vitest.eval.config.ts package.json
git commit -m "build(7c-D): yarn eval — DEMO-mode vitest config for the golden-set harness"
```

---

## Task 3: Eval runner + first passing scenario (lead-inbox reply approve)

This is the TDD driver: write the lead-inbox reply-approve scenario test first (it fails — no runner), then implement the runner until it passes.

**Files:**
- Create: `apps/inbox/eval/scenarios/lead-inbox.ts`
- Create: `apps/inbox/eval/lead-inbox.eval.ts`
- Create: `apps/inbox/eval/runner.ts`

- [ ] **Step 1: Write the scenario data (`scenarios/lead-inbox.ts`) — reply-approve only for now**

```ts
import type { GoldenScenario } from '../runner.js'

export const leadInboxScenarios: GoldenScenario[] = [
  {
    name: 'reply: drafts a reply and opens a saveDraft approval gate; approve fires the effect',
    workflow: 'lead-inbox',
    entryAgent: 'reply',
    payload: { lead: { from: 'sam@harborfreight.example', subject: 'pricing' } },
    // default gate decision = approve
    expect: {
      gates: [{ toolName: 'saveDraft', kind: 'approval', formKeys: ['threadId', 'body'] }],
      effects: [{ toolName: 'saveDraft' }],
      finalStatuses: { 'lead-inbox__reply': 'finished' },
    },
  },
]
```

- [ ] **Step 2: Write the vitest file (`lead-inbox.eval.ts`)**

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { runMigrations, resetDb } from '@atizar/server'
import { runGolden } from './runner.js'
import { leadInboxScenarios } from './scenarios/lead-inbox.js'

beforeAll(async () => {
  await runMigrations()
})
beforeEach(async () => {
  await resetDb()
})

describe('lead-inbox golden set', () => {
  for (const scenario of leadInboxScenarios) {
    it(scenario.name, async () => {
      const facts = await runGolden(scenario)

      // Gates: shape only (kind, toolName, form keys), not LLM prose.
      expect(facts.gates).toHaveLength(scenario.expect.gates?.length ?? 0)
      for (const exp of scenario.expect.gates ?? []) {
        const g = facts.gates.find((x) => x.toolName === exp.toolName)
        expect(g, `gate ${exp.toolName}`).toBeDefined()
        expect(g!.kind).toBe(exp.kind)
        for (const k of exp.formKeys) expect(g!.formKeys).toContain(k)
      }

      // Effects: the SERVER fired each expected effect exactly once.
      for (const exp of scenario.expect.effects ?? []) {
        const fired = facts.effects.filter((e) => e.toolName === exp.toolName)
        expect(fired, `effect ${exp.toolName} fired once`).toHaveLength(1)
      }
      if ((scenario.expect.effects ?? []).length === 0) {
        expect(facts.effects).toHaveLength(0)
      }

      // Final statuses + resolution markers per agent instance id.
      for (const [agentId, status] of Object.entries(scenario.expect.finalStatuses ?? {})) {
        const item = facts.items.find((i) => i.agentId === agentId)
        expect(item, `item for ${agentId}`).toBeDefined()
        expect(item!.status).toBe(status)
      }
      for (const [agentId, resolution] of Object.entries(scenario.expect.resolutions ?? {})) {
        const item = facts.items.find((i) => i.agentId === agentId)
        expect(item!.resolution).toBe(resolution)
      }
    })
  }
})
```

- [ ] **Step 3: Run the test to verify it FAILS (no runner module yet)**

Run: `yarn eval`
Expected: FAIL — `Cannot find module './runner.js'` (or a type error). This confirms the test drives the runner.

- [ ] **Step 4: Implement `apps/inbox/eval/runner.ts`**

```ts
import type { Provider } from '@atizar/core'
import { instanceId, composeInstructions } from '@atizar/core'
import { db, makePipelineService, type AgentRuntime } from '@atizar/server'
import { providerRegistry } from '../server/providers.js'
import { buildProvider } from '../server/build-agent.js'
import { workflowServers } from '../server/workflows.js'

// A WorkItem is "done" when no further work can happen without external input.
const DONE = new Set(['finished', 'error', 'closed'])

export type GateFacts = {
  workItemId: string
  kind: string
  toolName: string
  formKeys: string[]
}

export type EffectCall = {
  agentId: string
  toolName: string
  form: Record<string, unknown>
}

export type ItemFacts = {
  id: string
  agentId: string
  parentId: string | null
  status: string
  resolution: string | null
  card: Record<string, unknown> | null
}

export type RunFacts = {
  items: ItemFacts[]
  gates: GateFacts[]
  effects: EffectCall[]
}

export type GoldenScenario = {
  name: string
  workflow: string
  entryAgent: string // bare agent id; the runner composes wf__agent
  payload: Record<string, unknown>
  // Resolve each open gate in arrival order. Default = approve with the gate's current form.
  gateScript?: (gate: GateFacts) => {
    decision: 'approved' | 'rejected'
    form?: Record<string, unknown>
    comment?: string
  }
  expect: {
    gates?: { toolName: string; kind: string; formKeys: string[] }[]
    effects?: { toolName: string }[]
    finalStatuses?: Record<string, string>
    resolutions?: Record<string, string>
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Build a real PipelineService over every workflow×agent, exactly as the server's composition
// root does — EXCEPT each agent's server effects are replaced by credential-free fakes that LOG
// every call (the eval asserts on the log instead of touching Gmail/GitHub or the ledger table).
// Runs under DEMO=1 → in-memory PGlite + the `demo` cassette-replay provider.
export function buildEvalService(): {
  service: ReturnType<typeof makePipelineService>
  effectCalls: EffectCall[]
} {
  const effectCalls: EffectCall[] = []
  const runtimes: Record<string, AgentRuntime> = {}

  for (const { descriptor, bindings } of workflowServers) {
    const byId = new Map(descriptor.agents.map((a) => [a.agent.id, a.agent]))
    for (const b of bindings(descriptor.id)) {
      const def = byId.get(b.agentId)
      if (!def) throw new Error(`eval: binding for unknown agent "${b.agentId}"`)
      const key = instanceId(descriptor.id, b.agentId)
      const composed = composeInstructions(descriptor.prompt, def.instructions)
      const provider = buildProvider(def, b.prompts, providerRegistry, b.allowedTools, key, composed)

      const fakeEffects: AgentRuntime['effects'] = {}
      for (const name of Object.keys(b.effects ?? {})) {
        fakeEffects[name] = async (form: Record<string, unknown>) => {
          effectCalls.push({ agentId: key, toolName: name, form })
          return { ok: true, draftId: `eval-${name}` }
        }
      }

      runtimes[key] = {
        provider,
        renderToolNames: Object.keys(def.renders),
        maxInstances: def.maxInstances,
        effects: fakeEffects,
        dispatchToolNames: def.dispatches,
        handoffs: def.handoffs ?? [],
      }
    }
  }

  const service = makePipelineService({
    db,
    resolveAgent: (id) => runtimes[id],
    descriptors: workflowServers.map((w) => w.descriptor),
  })
  return { service, effectCalls }
}

export async function runGolden(scenario: GoldenScenario): Promise<RunFacts> {
  const { service, effectCalls } = buildEvalService()
  const gatesSeen: GateFacts[] = []

  await service.dispatch({
    workflowId: scenario.workflow,
    agentId: instanceId(scenario.workflow, scenario.entryAgent),
    origin: 'human',
    payload: scenario.payload,
    source: null,
    parentId: null,
  })

  const startedAt = Date.now()
  for (;;) {
    if (Date.now() - startedAt > 45_000) throw new Error(`eval: "${scenario.name}" did not quiesce`)
    const { items, gates } = await service.getBoard() // getBoard returns only OPEN gates

    if (gates.length > 0) {
      const gate = gates[0]
      const facts: GateFacts = {
        workItemId: gate.workItemId,
        kind: gate.kind,
        toolName: gate.toolName,
        formKeys: Object.keys((gate.form ?? gate.proposedArtifact ?? {}) as Record<string, unknown>),
      }
      gatesSeen.push(facts)
      const choice = scenario.gateScript?.(facts) ?? { decision: 'approved' as const }
      const res = await service.resolveGate(gate.id, {
        formRev: gate.formRev,
        decision: choice.decision,
        form: choice.form,
        comment: choice.comment,
      })
      if (!res.ok && res.status !== 404) {
        throw new Error(`eval: resolveGate failed (${res.status}) ${res.error}`)
      }
      continue
    }

    const active = items.filter((i) => !DONE.has(i.status))
    if (active.length === 0) {
      return {
        items: items.map((i) => ({
          id: i.id,
          agentId: i.agentId,
          parentId: i.parentId,
          status: i.status,
          resolution: i.resolution,
          card: (i.card as Record<string, unknown> | null) ?? null,
        })),
        gates: gatesSeen,
        effects: effectCalls,
      }
    }
    await sleep(15)
  }
}

// Re-exported so the cap test can inject a custom runtime (F1).
export type { Provider, AgentRuntime }
```

- [ ] **Step 5: Run the test to verify it PASSES**

Run: `yarn eval`
Expected: PASS — `lead-inbox golden set › reply: drafts a reply...` green. The harness dispatches `lead-inbox__reply`, the demo cassette replays renderLead+saveDraft+GATE_OPENED, the runner approves, the fake `saveDraft` fires once, the item finishes.

- [ ] **Step 6: typecheck + lint, then commit**

Run: `yarn typecheck && yarn lint`
Expected: green.
```bash
git add apps/inbox/eval/runner.ts apps/inbox/eval/scenarios/lead-inbox.ts apps/inbox/eval/lead-inbox.eval.ts
git commit -m "test(7c-D): eval harness + lead-inbox reply-approve golden scenario"
```

---

## Task 4: Remaining lead-inbox scenarios (qualifier, reply-reject)

**Files:**
- Modify: `apps/inbox/eval/scenarios/lead-inbox.ts`

- [ ] **Step 1: Add the qualifier and reply-reject scenarios**

Append to `leadInboxScenarios`:
```ts
  {
    name: 'qualifier: surfaces a verdict card and finishes with no gate',
    workflow: 'lead-inbox',
    entryAgent: 'qualifier',
    payload: { lead: { from: 'sam@harborfreight.example', subject: 'pricing' } },
    expect: {
      gates: [],
      effects: [],
      finalStatuses: { 'lead-inbox__qualifier': 'finished' },
    },
  },
  {
    name: 'reply: reject leaves the item finished/rejected and fires no effect',
    workflow: 'lead-inbox',
    entryAgent: 'reply',
    payload: { lead: { from: 'sam@harborfreight.example', subject: 'pricing' } },
    gateScript: () => ({ decision: 'rejected', comment: 'not now' }),
    expect: {
      gates: [{ toolName: 'saveDraft', kind: 'approval', formKeys: ['threadId', 'body'] }],
      effects: [],
      finalStatuses: { 'lead-inbox__reply': 'finished' },
      resolutions: { 'lead-inbox__reply': 'rejected' },
    },
  },
```

- [ ] **Step 2: Run the eval**

Run: `yarn eval`
Expected: all three lead-inbox scenarios PASS. (Qualifier: VerdictCard card set, no gate, finished. Reject: gate seen, no effect fired, `resolution: 'rejected'`.)

- [ ] **Step 3: Commit**

```bash
git add apps/inbox/eval/scenarios/lead-inbox.ts
git commit -m "test(7c-D): lead-inbox qualifier + reply-reject golden scenarios"
```

---

## Task 5: email-inbox sorter fan-out scenario

email-inbox already has all five committed cassettes. Dispatching the `sorter` replays its `route_emails` dispatch tool, which the RunObserver turns into machine-dispatched children (reader/spam/important/reply) — exercising machine-dispatch + batch gates in one scenario.

**Files:**
- Create: `apps/inbox/eval/scenarios/email-inbox.ts`
- Create: `apps/inbox/eval/email-inbox.eval.ts`

- [ ] **Step 1: Inspect the committed sorter cassette to learn the exact child agentIds + a batch gate's form key**

Run:
```bash
cd /Users/yaroshuk/Development/AiWorkflow
python3 - <<'PY'
import json
for l in open('apps/inbox/demo-cassettes/email-inbox__sorter.jsonl'):
    e=json.loads(l)['event']
    if e.get('type')=='TOOL_CALL_ARGS': print(e.get('delta',''),end='')
print()
PY
for f in spam reader important; do echo "== $f =="; grep -o '"name":"GATE_OPENED"[^}]*"toolName":"[^"]*"' apps/inbox/demo-cassettes/email-inbox__$f.jsonl | head -1; done
```
Expected: the `route_emails` args reveal the `to` targets (the children the sorter dispatches); the grep reveals each batch agent's approval `toolName` (expected `applyActions`). Use the observed values in Step 2's `expect` block. (If a child agent id differs from the guess below, use the real one — do not assert a guessed id.)

- [ ] **Step 2: Write the scenario (`scenarios/email-inbox.ts`)**

```ts
import type { GoldenScenario } from '../runner.js'

// NOTE: the exact child agent ids + the batch gate's form key are read from the committed
// sorter/batch cassettes in Task 5 Step 1 — adjust the literals below to match what replays.
export const emailInboxScenarios: GoldenScenario[] = [
  {
    name: 'sorter: machine-dispatches a child per route and a batch agent opens an applyActions gate',
    workflow: 'email-inbox',
    entryAgent: 'sorter',
    payload: {},
    // approve every gate that opens (each batch agent's applyActions)
    expect: {
      // The sorter itself finishes; assert at least the batch children exist + a gate opened.
      gates: [{ toolName: 'applyActions', kind: 'approval', formKeys: ['items'] }],
      effects: [{ toolName: 'applyActions' }],
      finalStatuses: { 'email-inbox__sorter': 'finished' },
    },
  },
]
```

- [ ] **Step 2a: Relax the assertion for the multi-gate fan-out**

The single-gate `expect.gates` shape in `runner.ts` asserts an exact length. The sorter fan-out may open MORE than one gate (one per batch agent). For this scenario, assert the gate set CONTAINS the expected shapes rather than equals. Add an optional `expect.gatesContainOnly?: boolean` to `GoldenScenario` and, when true, skip the `toHaveLength` check in the vitest file (assert each expected gate is present, allow extras). Implement in the new `email-inbox.eval.ts` directly rather than touching the lead-inbox file:

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { runMigrations, resetDb } from '@atizar/server'
import { runGolden } from './runner.js'
import { emailInboxScenarios } from './scenarios/email-inbox.js'

beforeAll(async () => {
  await runMigrations()
})
beforeEach(async () => {
  await resetDb()
})

describe('email-inbox golden set', () => {
  for (const scenario of emailInboxScenarios) {
    it(scenario.name, async () => {
      const facts = await runGolden(scenario)
      // CONTAINS (not equals) — the fan-out opens one gate per batch agent.
      for (const exp of scenario.expect.gates ?? []) {
        const g = facts.gates.find((x) => x.toolName === exp.toolName)
        expect(g, `gate ${exp.toolName}`).toBeDefined()
        expect(g!.kind).toBe(exp.kind)
        for (const k of exp.formKeys) expect(g!.formKeys).toContain(k)
      }
      for (const exp of scenario.expect.effects ?? []) {
        expect(facts.effects.filter((e) => e.toolName === exp.toolName).length).toBeGreaterThanOrEqual(1)
      }
      for (const [agentId, status] of Object.entries(scenario.expect.finalStatuses ?? {})) {
        const item = facts.items.find((i) => i.agentId === agentId)
        expect(item, `item for ${agentId}`).toBeDefined()
        expect(item!.status).toBe(status)
      }
      // The sorter machine-dispatched children: at least one child item exists.
      const sorterId = facts.items.find((i) => i.agentId === 'email-inbox__sorter')?.id
      expect(facts.items.some((i) => i.parentId === sorterId)).toBe(true)
    })
  }
})
```

- [ ] **Step 3: Run the eval**

Run: `yarn eval`
Expected: the email-inbox sorter scenario PASSES — children dispatched under the sorter, an `applyActions` gate opened (form has `items`), approve fired the fake effect, sorter finished. If it does not quiesce, check that every dispatched child has a committed cassette under `demo-cassettes/` (a `DemoCassetteMissing` throw names the missing key).

- [ ] **Step 4: Commit**

```bash
git add apps/inbox/eval/scenarios/email-inbox.ts apps/inbox/eval/email-inbox.eval.ts
git commit -m "test(7c-D): email-inbox sorter fan-out golden scenario"
```

---

## Task 6: F1 — observable 3-at-once cap (blocking provider)

A self-contained eval test: build a `PipelineService` with a custom `resolveAgent` returning a runtime whose provider BLOCKS on a controllable promise, so slots stay held and the cap is observable via `service.stats(agentId)`.

**Files:**
- Create: `apps/inbox/eval/cap.eval.ts`

- [ ] **Step 1: Write the cap test**

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import type { BaseEvent } from '@ag-ui/client'
import type { Provider } from '@atizar/core'
import { runMigrations, resetDb, db, makePipelineService, type AgentRuntime } from '@atizar/server'

beforeAll(async () => {
  await runMigrations()
})
beforeEach(async () => {
  await resetDb()
})

// A provider whose run() parks until `release` is called, holding its pool slot.
function blockingProvider(gate: Promise<void>): Provider {
  return {
    async *run(): AsyncIterable<BaseEvent> {
      await gate
      // clean empty finish → observer transitions running → finished, releasing the slot
    },
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('worker cap (F1)', () => {
  it('admits maxInstances=2 and queues the 3rd, then auto-starts it on release', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const AGENT = 'cap-wf__blocker'
    const runtime: AgentRuntime = {
      provider: blockingProvider(gate),
      renderToolNames: [],
      maxInstances: 2,
      effects: {},
      dispatchToolNames: [],
      handoffs: [],
    }
    const service = makePipelineService({
      db,
      resolveAgent: (id) => (id === AGENT ? runtime : undefined),
      descriptors: [],
    })

    const dispatch = () =>
      service.dispatch({
        workflowId: 'cap-wf',
        agentId: AGENT,
        origin: 'agent', // 'agent' so the singleton-START reject path does not apply
        payload: {},
        source: null,
        parentId: null,
      })
    await dispatch()
    await dispatch()
    await dispatch()

    // wait until the pool has started the 2 admitted runs
    const startedAt = Date.now()
    while (service.stats(AGENT).active < 2 && Date.now() - startedAt < 5000) await sleep(10)

    expect(service.stats(AGENT)).toEqual({ active: 2, queued: 1 })

    release()

    // the parked runs finish, freeing slots; the queued 3rd auto-starts and (also released) finishes
    const drainAt = Date.now()
    while (service.stats(AGENT).active + service.stats(AGENT).queued > 0 && Date.now() - drainAt < 5000)
      await sleep(10)

    expect(service.stats(AGENT)).toEqual({ active: 0, queued: 0 })
  })
})
```

- [ ] **Step 2: Run the eval**

Run: `yarn eval`
Expected: the cap test PASSES — mid-flight `{active:2, queued:1}`, and after `release()` everything drains to `{active:0, queued:0}` (the queued 3rd auto-started). If `stats` never reaches `active:2`, the dispatch origin or `maxInstances` wiring regressed.

- [ ] **Step 3: typecheck + lint, then commit**

Run: `yarn typecheck && yarn lint`
```bash
git add apps/inbox/eval/cap.eval.ts
git commit -m "test(7c-D): F1 — observable 3-at-once cap via blocking provider"
```

---

## Task 7: F2 — browser-verify cross-workflow "Treat as lead → Lead inbox"

A browser E2E (not a replay assertion). Record a github-triage cassette live (reads the real GitHub board READ-ONLY), then drive the UI through the handoff.

**Files:** none committed (the recorded triage cassette stays in gitignored `.cassettes/`).

- [ ] **Step 1: Invoke the `browser-verify` skill** (kills stale dev stacks, frees `:4000`/`:5173`, recovers the Playwright-MCP profile lock). Follow it before driving the browser.

- [ ] **Step 2: Record a github-triage cassette (live, read-only)**

```bash
cd /Users/yaroshuk/Development/AiWorkflow
# GitHub read-only triage run; writes apps/inbox/.cassettes/github-triage__*.jsonl (gitignored).
DEV_RECORD_REPLAY=record yarn dev
```
In the browser at `http://localhost:5173`: open the **GitHub triage** workflow, START the triage agent, let it finish (it reads the real board read-only and renders a triage/verdict card with a "Treat as lead" handoff button). Stop the dev server. Confirm `apps/inbox/.cassettes/github-triage__*.jsonl` now exist. **Never commit these** (real board data; the `guard-cassette-share` hook + `scanCassette` guard this).

- [ ] **Step 3: Replay and drive the handoff in the browser**

```bash
DEV_RECORD_REPLAY=1 yarn dev
```
In the browser: START the triage agent (replays instantly) → on its card click **"Treat as lead"** → switch to the **Lead inbox** workflow.
Expected: a child lead-inbox WorkItem appears, nested under the triage item (the ↓ connector), and runs through the qualifier (or to its gate). Capture a screenshot/snapshot showing the nested child. This verifies `resolveDelivery`/`deliveryKey` + `POST /api/deliver` live.

- [ ] **Step 4: Record the result inline** (no commit — this task produces verification evidence, not code). Note in the eventual HANDOFF update (Task 8) the screenshot path + the observed child instance id.

---

## Task 8: github-triage golden scenario (STRETCH) + HANDOFF + foundation

- [ ] **Step 1 (STRETCH — skip if it balloons): synthetic github-triage cassette + scenario**

If the triage flow replays cleanly through the harness (the triage agent reads the board via a tool whose result is captured in the cassette), author a synthetic `apps/inbox/demo-cassettes/github-triage__triage.jsonl` (invented tickets) and add `scenarios/github-triage.ts` + `github-triage.eval.ts` asserting the verdict card + finished. If the board-read tool surfacing fights the harness, SKIP and note it (triage stays covered by Task 7 + integration tests). Either way, state the outcome explicitly in Step 2 — no silent coverage gap. If built: `git commit -m "test(7c-D): synthetic github-triage golden scenario"` (run `demo:scan-cassettes` first).

- [ ] **Step 2: Run the `check-foundation` skill**

The harness touches providers (injected fake/blocking provider) and the framework/userland boundary (eval lives in `apps/inbox`, imports only `@atizar/*` + the app's own server modules). Expected verdict: CLEAR (no new engine import into `@atizar/core`; no userland reach into package internals).

- [ ] **Step 3: Full green gate**

Run:
```bash
yarn typecheck && yarn lint && yarn test && yarn eval && yarn build
```
Expected: all green. (`yarn test` = unit suite on the test Postgres; `yarn eval` = the golden set on PGlite.)

- [ ] **Step 4: Update `HANDOFF.md`** — mark sub-project 7c-D ✅ BUILT with an as-built note: the harness location + `yarn eval`, the synthetic lead-inbox cassettes, the scenarios per workflow, F1 (observable cap), F2 (browser-verified handoff + screenshot path + the github-triage cassette stays gitignored), and the github-triage-stretch outcome. Add the deviation note (`yarn eval` is separate from `yarn test`; CI runs both).

- [ ] **Step 5: Commit**

```bash
git add HANDOFF.md
git commit -m "docs(7c-D): golden-set eval + step-6 follow-ups BUILT & verified"
```

---

## Self-review

**Spec coverage:**
- C1 golden harness → Tasks 1–5, 8 ✓
- Structural assertions (tree, gates, statuses, effects, cards) → runner `RunFacts` + the vitest files ✓
- Fixtures = committed synthetic cassettes, lead-inbox authored → Task 1 ✓
- `yarn eval`, CI-safe, no creds → Task 2 (DEMO=1 + PGlite + fake effects) ✓
- F1 observable cap → Task 6 ✓
- F2 cross-workflow browser flow → Task 7 ✓
- github-triage deterministic = stretch → Task 8 Step 1 ✓
- `check-foundation` + green gate → Task 8 ✓

**Placeholder scan:** no TBD/TODO; every code step shows actual content. The only deliberate "adjust to observed values" is Task 5 Step 1→2 (child agent ids / form keys read from the real committed cassette) — with an explicit command to read them and instruction not to assert guessed ids.

**Type consistency:** `GoldenScenario`/`RunFacts`/`GateFacts`/`EffectCall`/`ItemFacts` defined once in `runner.ts` (Task 3) and consumed by every scenario/test file. `buildEvalService` return shape (`{ service, effectCalls }`) is used consistently. `service.stats(agentId) → {active, queued}`, `service.getBoard() → {items, gates, ...}`, `service.resolveGate(id, {formRev, decision, form?, comment?})`, `service.dispatch({workflowId, agentId, origin, payload, source, parentId})` all match the signatures in `packages/server/src/pipelineService.ts`. `AgentRuntime` fields (`provider, renderToolNames, maxInstances, effects, dispatchToolNames, handoffs`) match `apps/inbox/server/index.ts`'s construction.
