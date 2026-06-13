# Dev record/replay provider — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dev-mode layer that records each real provider run to disk once, then replays it instantly — so workflow developers iterate without waiting on the real `claude`.

**Architecture:** A `Provider → Provider` decorator (`withRecordReplay`) toggled by the `DEV_RECORD_REPLAY` env var, wrapped around the real provider in `build-agent.ts`. Recordings are keyed by `wf__agent` + step (= number of resolved approvals). One JSONL file per agent holds all steps, each line `{step, event}`. On each run: replay the step if recorded, else call the real provider, pass events through, and append them. Cassettes are gitignored; a `scanCassette` helper backs a mandatory agent safety-scan before any cassette is shared.

**Tech Stack:** TypeScript, yarn-classic workspace, `@atizar/core` (isomorphic), Node `fs/promises` (server-only), vitest, AG-UI `BaseEvent`/`Message` types.

**Spec:** `docs/superpowers/specs/2026-06-08-dev-record-replay-design.md`

---

## File structure

- **Modify** `packages/core/src/messages.ts` — add pure `resolvedApprovalCount`.
- **Modify** `packages/core/src/messages.test.ts` — tests for it.
- **Create** `apps/inbox/server/record-replay.ts` — pure line helpers, `scanCassette`, `CassetteStore` (fs), `recordReplayMode`, `cassettesDir`, `withRecordReplay`.
- **Create** `apps/inbox/server/record-replay.test.ts` — tests (pure helpers + decorator over a fake provider + temp dir).
- **Modify** `apps/inbox/server/build-agent.ts` — accept `instanceKey`; wrap provider when the env flag is set.
- **Modify** `apps/inbox/server/index.ts` — pass the instance id into `buildAgent`.
- **Modify** `.gitignore` — ignore `apps/inbox/.cassettes/`.
- **Docs:** `docs/ARCHITECTURE.md`, `docs/BUILD-LOG.md`, `CLAUDE.md`, `HANDOFF.md`, and a developer-facing feature doc `docs/dev-record-replay.md` (skill seed).

Commands (repo root): `yarn test`, `yarn typecheck`, `yarn lint`, `yarn format`.

---

## Task 1: `resolvedApprovalCount` in `@atizar/core`

**Files:**
- Modify: `packages/core/src/messages.ts`
- Test: `packages/core/src/messages.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/src/messages.test.ts` — first add `resolvedApprovalCount` to the import list from `./messages.js`, then append:

```ts
describe('resolvedApprovalCount', () => {
  const APPROVALS = ['confirmSend']

  it('0 when no approval has been answered', () => {
    expect(resolvedApprovalCount([assistantWithToolCall('confirmSend', 'x1')], APPROVALS)).toBe(0)
  })

  it('1 when one approval call has a matching tool result', () => {
    const msgs = [assistantWithToolCall('confirmSend', 'x1'), toolResult('x1')]
    expect(resolvedApprovalCount(msgs, APPROVALS)).toBe(1)
  })

  it('counts distinct resolved approvals, ignores non-approvals', () => {
    const msgs = [
      assistantWithToolCall('confirmSend', 'x1'),
      toolResult('x1'),
      assistantWithToolCall('renderLead', 'r1'),
      toolResult('r1'),
      assistantWithToolCall('confirmSend', 'x2'),
      toolResult('x2'),
    ]
    expect(resolvedApprovalCount(msgs, APPROVALS)).toBe(2)
  })

  it('does not count an unanswered approval call', () => {
    const msgs = [
      assistantWithToolCall('confirmSend', 'x1'),
      toolResult('x1'),
      assistantWithToolCall('confirmSend', 'x2'),
    ]
    expect(resolvedApprovalCount(msgs, APPROVALS)).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test packages/core/src/messages.test.ts`
Expected: FAIL — `resolvedApprovalCount is not a function` / import error.

- [ ] **Step 3: Implement**

Append to `packages/core/src/messages.ts` (after `approvalResolved`):

```ts
// The number of DISTINCT approval tool calls that have a matching role:"tool"
// result — i.e. how many human approvals are already behind us in this run.
// Used by the dev record/replay layer as the "step" index (step 0 = first run,
// step 1 = after the 1st approval, …). Counterpart of approvalResolved (which is
// just `resolvedApprovalCount(...) > 0`). Approval names come from def.approvals.
export function resolvedApprovalCount(
  messages: readonly Message[],
  approvalNames: readonly string[]
): number {
  const approvalCallIds = new Set<string>()
  for (const m of messages) {
    for (const tc of toolCallsOf(m)) {
      if (approvalNames.includes(tc.function.name) && typeof tc.id === 'string') {
        approvalCallIds.add(tc.id)
      }
    }
  }
  const answered = new Set<string>()
  for (const m of messages) {
    if (isToolMessage(m) && typeof m.toolCallId === 'string' && approvalCallIds.has(m.toolCallId)) {
      answered.add(m.toolCallId)
    }
  }
  return answered.size
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test packages/core/src/messages.test.ts`
Expected: PASS (all `resolvedApprovalCount` cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/messages.ts packages/core/src/messages.test.ts
git commit -m "feat(core): resolvedApprovalCount — approval count as the replay step index"
```

---

## Task 2: Pure cassette line helpers

**Files:**
- Create: `apps/inbox/server/record-replay.ts`
- Test: `apps/inbox/server/record-replay.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/inbox/server/record-replay.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { EventType, type BaseEvent } from '@ag-ui/client'
import { encodeLine, parseLine, eventsForStep, dropStep } from './record-replay.js'

const ev = (delta: string): BaseEvent =>
  ({ type: EventType.TEXT_MESSAGE_CHUNK, role: 'assistant', messageId: 'm', delta }) as BaseEvent

describe('cassette line helpers', () => {
  it('encodeLine/parseLine round-trip', () => {
    const line = encodeLine(2, ev('hi'))
    expect(parseLine(line)).toEqual({ step: 2, event: ev('hi') })
  })

  it('parseLine returns null on blank or invalid lines', () => {
    expect(parseLine('')).toBeNull()
    expect(parseLine('   ')).toBeNull()
    expect(parseLine('not json')).toBeNull()
    expect(parseLine('{"event":{}}')).toBeNull() // no numeric step
  })

  it('eventsForStep returns only that step’s events in order', () => {
    const text = [encodeLine(0, ev('a')), encodeLine(1, ev('b')), encodeLine(0, ev('c'))].join('\n')
    expect(eventsForStep(text, 0)).toEqual([ev('a'), ev('c')])
    expect(eventsForStep(text, 1)).toEqual([ev('b')])
    expect(eventsForStep(text, 5)).toEqual([])
  })

  it('dropStep keeps every line except the given step', () => {
    const text = [encodeLine(0, ev('a')), encodeLine(1, ev('b'))].join('\n')
    expect(dropStep(text, 0)).toBe(encodeLine(1, ev('b')))
    expect(dropStep(text, 1)).toBe(encodeLine(0, ev('a')))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test apps/inbox/server/record-replay.test.ts`
Expected: FAIL — cannot find module `./record-replay.js`.

- [ ] **Step 3: Implement the pure helpers**

Create `apps/inbox/server/record-replay.ts`:

```ts
import type { BaseEvent } from '@ag-ui/client'

// A cassette file is JSONL: one recorded AG-UI event per line, tagged with its
// step. Step = how many human approvals are already behind us (see
// resolvedApprovalCount). All of one agent's steps live in ONE file.

export function encodeLine(step: number, event: BaseEvent): string {
  return JSON.stringify({ step, event })
}

export function parseLine(line: string): { step: number; event: BaseEvent } | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const obj = JSON.parse(trimmed) as { step?: unknown; event?: unknown }
    if (typeof obj.step === 'number' && obj.event) {
      return { step: obj.step, event: obj.event as BaseEvent }
    }
  } catch {
    // not a cassette line
  }
  return null
}

export function eventsForStep(text: string, step: number): BaseEvent[] {
  const out: BaseEvent[] = []
  for (const line of text.split('\n')) {
    const parsed = parseLine(line)
    if (parsed && parsed.step === step) out.push(parsed.event)
  }
  return out
}

// Keep every valid line whose step differs (drops blank/invalid lines too).
export function dropStep(text: string, step: number): string {
  return text
    .split('\n')
    .filter((line) => {
      const parsed = parseLine(line)
      return parsed !== null && parsed.step !== step
    })
    .join('\n')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test apps/inbox/server/record-replay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/server/record-replay.ts apps/inbox/server/record-replay.test.ts
git commit -m "feat(server): cassette JSONL line helpers (encode/parse/eventsForStep/dropStep)"
```

---

## Task 3: `scanCassette` — share-safety heuristic scan

**Files:**
- Modify: `apps/inbox/server/record-replay.ts`
- Test: `apps/inbox/server/record-replay.test.ts`

Note: regex reliably catches emails, phones, and token-shaped/keyword-tagged secrets. Personal **names** and **addresses** are not reliably regex-detectable — the mandatory human warning (CLAUDE.md rule) covers those. The scan is a safety net, not a guarantee.

- [ ] **Step 1: Write the failing tests**

Add to `apps/inbox/server/record-replay.test.ts` — extend the import to include `scanCassette`, then append:

```ts
describe('scanCassette', () => {
  it('flags an email with its 1-based line number', () => {
    const text = ['clean line', 'contact ivan@acme.ru about it'].join('\n')
    const found = scanCassette(text)
    expect(found).toContainEqual({ line: 2, kind: 'email', snippet: 'ivan@acme.ru' })
  })

  it('flags a token-shaped secret', () => {
    const found = scanCassette('authorization: ghp_ABCDEFGHIJKLMNOP1234')
    expect(found.some((f) => f.kind === 'secret')).toBe(true)
  })

  it('flags a keyword-tagged secret', () => {
    const found = scanCassette('api_key = supersecretvalue123')
    expect(found.some((f) => f.kind === 'secret')).toBe(true)
  })

  it('returns empty on plain prose', () => {
    expect(scanCassette('the customer asked about delivery time')).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test apps/inbox/server/record-replay.test.ts`
Expected: FAIL — `scanCassette is not a function`.

- [ ] **Step 3: Implement**

Append to `apps/inbox/server/record-replay.ts`:

```ts
// A heuristic safety-net scan run BEFORE a cassette is ever shared/committed.
// Catches mechanically-detectable PII/secrets (emails, phones, token-shaped or
// keyword-tagged secrets) with line numbers. Names/addresses are NOT reliably
// detectable here — the human is the final reviewer (see the CLAUDE.md rule).
export interface Finding {
  line: number
  kind: 'email' | 'phone' | 'secret'
  snippet: string
}

const PATTERNS: ReadonlyArray<readonly [Finding['kind'], RegExp]> = [
  ['email', /[\w.+-]+@[\w-]+\.[\w.-]+/g],
  ['phone', /(?<!\d)\+?\d[\d ()-]{7,}\d(?!\d)/g],
  [
    'secret',
    /\b(?:sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{16,})\b|(?:bearer|token|api[_-]?key|secret|password)\s*[:=]\s*\S+/gi,
  ],
]

export function scanCassette(text: string): Finding[] {
  const out: Finding[] = []
  text.split('\n').forEach((line, i) => {
    for (const [kind, re] of PATTERNS) {
      for (const match of line.matchAll(re)) {
        out.push({ line: i + 1, kind, snippet: match[0] })
      }
    }
  })
  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test apps/inbox/server/record-replay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/server/record-replay.ts apps/inbox/server/record-replay.test.ts
git commit -m "feat(server): scanCassette — heuristic PII/secret scan for share-safety"
```

---

## Task 4: `CassetteStore` — read/write a step on disk

**Files:**
- Modify: `apps/inbox/server/record-replay.ts`
- Test: `apps/inbox/server/record-replay.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/inbox/server/record-replay.test.ts` — extend the import to include `CassetteStore`, and add these node imports at the top:

```ts
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
```

Then append:

```ts
describe('CassetteStore', () => {
  it('readStep returns null when the file does not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cassette-'))
    const store = new CassetteStore(dir, 'wf__agent')
    expect(await store.readStep(0)).toBeNull()
  })

  it('writeStep then readStep round-trips that step’s events', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cassette-'))
    const store = new CassetteStore(dir, 'wf__agent')
    await store.writeStep(0, [ev('a'), ev('b')])
    expect(await store.readStep(0)).toEqual([ev('a'), ev('b')])
    expect(await store.readStep(1)).toBeNull()
  })

  it('writeStep preserves other steps in the same file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cassette-'))
    const store = new CassetteStore(dir, 'wf__agent')
    await store.writeStep(0, [ev('a')])
    await store.writeStep(1, [ev('b')])
    expect(await store.readStep(0)).toEqual([ev('a')])
    expect(await store.readStep(1)).toEqual([ev('b')])
  })

  it('writeStep replaces (overwrites) an existing step', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cassette-'))
    const store = new CassetteStore(dir, 'wf__agent')
    await store.writeStep(0, [ev('old')])
    await store.writeStep(0, [ev('new')])
    expect(await store.readStep(0)).toEqual([ev('new')])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test apps/inbox/server/record-replay.test.ts`
Expected: FAIL — `CassetteStore is not a constructor`.

- [ ] **Step 3: Implement**

Add to the top imports of `apps/inbox/server/record-replay.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
```

Append to `apps/inbox/server/record-replay.ts`:

```ts
async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null // ENOENT (or unreadable) → treat as "no recording yet"
  }
}

// One JSONL file per agent key, holding every step. readStep returns null when
// the step has no recorded events (→ caller records it). writeStep replaces just
// that step's lines, leaving other steps intact.
export class CassetteStore {
  constructor(
    private readonly dir: string,
    private readonly key: string
  ) {}

  private file(): string {
    return join(this.dir, `${this.key}.jsonl`)
  }

  async readStep(step: number): Promise<BaseEvent[] | null> {
    const text = await readFileOrNull(this.file())
    if (text === null) return null
    const events = eventsForStep(text, step)
    return events.length > 0 ? events : null
  }

  async writeStep(step: number, events: BaseEvent[]): Promise<void> {
    const existing = (await readFileOrNull(this.file())) ?? ''
    const kept = dropStep(existing, step)
    const added = events.map((e) => encodeLine(step, e)).join('\n')
    const body = [kept, added].filter((s) => s.length > 0).join('\n')
    await mkdir(this.dir, { recursive: true })
    await writeFile(this.file(), body + '\n', 'utf8')
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test apps/inbox/server/record-replay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/server/record-replay.ts apps/inbox/server/record-replay.test.ts
git commit -m "feat(server): CassetteStore — per-agent JSONL step read/write on disk"
```

---

## Task 5: `withRecordReplay` decorator + mode/dir helpers

**Files:**
- Modify: `apps/inbox/server/record-replay.ts`
- Test: `apps/inbox/server/record-replay.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/inbox/server/record-replay.test.ts` — extend the import to include `withRecordReplay`, add the core/provider imports at the top:

```ts
import type { Provider } from '@atizar/core'
import type { RunAgentInput } from '@ag-ui/client'
```

Then append:

```ts
// A fake real provider that records how many times it was actually invoked.
function fakeProvider(events: BaseEvent[]) {
  let calls = 0
  const provider: Provider = {
    async *run() {
      calls++
      for (const e of events) yield e
    },
  }
  return { provider, calls: () => calls }
}

const APPROVALS = ['confirmSend']
const step0Input = { messages: [] } as unknown as RunAgentInput
// messages with one resolved approval → resolvedApprovalCount === 1 → step 1
const step1Input = {
  messages: [
    { role: 'assistant', id: 'a1', toolCalls: [{ id: 'x1', type: 'function', function: { name: 'confirmSend', arguments: '{}' } }] },
    { role: 'tool', id: 't1', content: 'ok', toolCallId: 'x1' },
  ],
} as unknown as RunAgentInput

async function collect(it: AsyncIterable<BaseEvent>): Promise<BaseEvent[]> {
  const out: BaseEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

describe('withRecordReplay', () => {
  it('miss → calls the real provider, passes events through, and records', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cassette-'))
    const fake = fakeProvider([ev('hi')])
    const wrapped = withRecordReplay(fake.provider, { key: 'wf__a', approvalNames: APPROVALS, dir, mode: 'replay' })
    const out = await collect(wrapped.run(step0Input))
    expect(out).toEqual([ev('hi')])
    expect(fake.calls()).toBe(1)
    expect(await new CassetteStore(dir, 'wf__a').readStep(0)).toEqual([ev('hi')])
  })

  it('hit → replays from disk WITHOUT calling the real provider', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cassette-'))
    const fake = fakeProvider([ev('hi')])
    const wrapped = withRecordReplay(fake.provider, { key: 'wf__a', approvalNames: APPROVALS, dir, mode: 'replay' })
    await collect(wrapped.run(step0Input)) // records (calls === 1)
    const out = await collect(wrapped.run(step0Input)) // replays
    expect(out).toEqual([ev('hi')])
    expect(fake.calls()).toBe(1) // NOT called again
  })

  it('mode "record" → overwrites even when a recording exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cassette-'))
    const fake = fakeProvider([ev('fresh')])
    await new CassetteStore(dir, 'wf__a').writeStep(0, [ev('stale')])
    const wrapped = withRecordReplay(fake.provider, { key: 'wf__a', approvalNames: APPROVALS, dir, mode: 'record' })
    const out = await collect(wrapped.run(step0Input))
    expect(out).toEqual([ev('fresh')])
    expect(fake.calls()).toBe(1)
    expect(await new CassetteStore(dir, 'wf__a').readStep(0)).toEqual([ev('fresh')])
  })

  it('replays step 0 but records step 1 on the resume run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cassette-'))
    const fake = fakeProvider([ev('done')])
    await new CassetteStore(dir, 'wf__a').writeStep(0, [ev('card')])
    const wrapped = withRecordReplay(fake.provider, { key: 'wf__a', approvalNames: APPROVALS, dir, mode: 'replay' })
    const out0 = await collect(wrapped.run(step0Input))
    expect(out0).toEqual([ev('card')])
    expect(fake.calls()).toBe(0) // step 0 was a hit
    const out1 = await collect(wrapped.run(step1Input))
    expect(out1).toEqual([ev('done')])
    expect(fake.calls()).toBe(1) // step 1 was a miss → recorded
    expect(await new CassetteStore(dir, 'wf__a').readStep(1)).toEqual([ev('done')])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test apps/inbox/server/record-replay.test.ts`
Expected: FAIL — `withRecordReplay is not a function`.

- [ ] **Step 3: Implement**

Add to the top imports of `apps/inbox/server/record-replay.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { resolvedApprovalCount, type Provider, type Message } from '@atizar/core'
import type { RunAgentInput } from '@ag-ui/client'
```

Append to `apps/inbox/server/record-replay.ts`:

```ts
export type RecordReplayMode = 'replay' | 'record'

// Reads the dev toggle. unset → null (no wrapping, pure production path).
// "record" → force-overwrite; anything else truthy ("1"/"replay") → auto
// (replay a step if recorded, else record it).
export function recordReplayMode(): RecordReplayMode | null {
  const v = process.env.DEV_RECORD_REPLAY
  if (!v) return null
  return v === 'record' ? 'record' : 'replay'
}

// apps/inbox/.cassettes/ — resolved relative to this module (server/), so it does
// not depend on the process cwd.
export function cassettesDir(): string {
  return fileURLToPath(new URL('../.cassettes/', import.meta.url))
}

// Wraps a real provider. Per run: step = resolved-approval count. In "replay"
// mode a recorded step is yielded without touching the real provider; a miss (or
// "record" mode) calls the real provider, passes every event through unchanged,
// and writes that step to disk.
export function withRecordReplay(
  provider: Provider,
  opts: { key: string; approvalNames: readonly string[]; dir: string; mode: RecordReplayMode }
): Provider {
  return {
    async *run(input: RunAgentInput): AsyncIterable<BaseEvent> {
      const messages = (input?.messages ?? []) as Message[]
      const step = resolvedApprovalCount(messages, opts.approvalNames)
      const store = new CassetteStore(opts.dir, opts.key)

      if (opts.mode === 'replay') {
        const recorded = await store.readStep(step)
        if (recorded) {
          yield* recorded
          return
        }
      }

      const captured: BaseEvent[] = []
      for await (const event of provider.run(input)) {
        captured.push(event)
        yield event
      }
      await store.writeStep(step, captured)
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test apps/inbox/server/record-replay.test.ts`
Expected: PASS (all four decorator cases green).

- [ ] **Step 5: Typecheck + lint + format**

Run: `yarn typecheck && yarn lint && yarn format`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/inbox/server/record-replay.ts apps/inbox/server/record-replay.test.ts
git commit -m "feat(server): withRecordReplay decorator + DEV_RECORD_REPLAY mode + cassettesDir"
```

---

## Task 6: Wire the decorator into agent building

**Files:**
- Modify: `apps/inbox/server/build-agent.ts`
- Modify: `apps/inbox/server/index.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Add `instanceKey` param + wrapping to `build-agent.ts`**

Replace the body of `apps/inbox/server/build-agent.ts` with:

```ts
import { BuiltInAgent } from '@copilotkit/runtime/v2'
import type { AgentDefinition, ProviderRegistry, PromptStrategy } from '@atizar/core'
import { withRecordReplay, recordReplayMode, cassettesDir } from './record-replay.js'

// Builds the CopilotKit BuiltInAgent for an agent passport: resolves the provider
// FACTORY from the registry by `def.provider`, then constructs the provider from the
// passport (approvals/tools) plus this agent's prompt strategy. All approval/turn
// logic lives in the provider, so there is no hardcoded tool name here.
//
// `instanceKey` is the runtime instance id (wf__agent) — used only as the cassette
// key when DEV_RECORD_REPLAY is set. When unset, the provider is returned unwrapped
// (byte-identical production path).
export function buildAgent(
  def: AgentDefinition,
  prompts: PromptStrategy,
  registry: ProviderRegistry,
  allowedTools: readonly string[],
  instanceKey: string
): BuiltInAgent {
  const makeProvider = registry.resolve(def.provider)
  let provider = makeProvider({
    approvalNames: def.approvals,
    surfaceTools: def.tools,
    allowedTools,
    prompts,
  })

  const mode = recordReplayMode()
  if (mode) {
    provider = withRecordReplay(provider, {
      key: instanceKey,
      approvalNames: def.approvals,
      dir: cassettesDir(),
      mode,
    })
  }

  return new BuiltInAgent({
    type: 'custom',
    factory: ({ input }) => provider.run(input),
  })
}
```

- [ ] **Step 2: Pass the instance id from `index.ts`**

In `apps/inbox/server/index.ts`, replace the registration block (around lines 30-40):

```ts
  for (const b of bindings(descriptor.id)) {
    const def = byId.get(b.agentId)
    if (!def)
      throw new Error(`server binding for unknown agent "${b.agentId}" in "${descriptor.id}"`)
    const key = instanceId(descriptor.id, b.agentId)
    agents[key] = buildAgent(def, b.prompts, providerRegistry, b.allowedTools, key)
  }
```

- [ ] **Step 3: Ignore cassettes**

Append to `.gitignore`:

```
# Dev record/replay cassettes — real captured email/ticket data, never commit
apps/inbox/.cassettes/
```

- [ ] **Step 4: Typecheck + lint**

Run: `yarn typecheck && yarn lint`
Expected: green (the new 5th `buildAgent` arg type-checks; only caller is `index.ts`).

- [ ] **Step 5: Smoke-run the server unwrapped (no flag)**

Run: `yarn dev:server`
Expected: `server on http://localhost:4000` with no error (production path unchanged). Stop it (Ctrl-C) after the line prints.

- [ ] **Step 6: Commit**

```bash
git add apps/inbox/server/build-agent.ts apps/inbox/server/index.ts .gitignore
git commit -m "feat(server): wrap providers in record/replay when DEV_RECORD_REPLAY is set"
```

---

## Task 7: Documentation (agentic-first — required, not optional)

**Files:**
- Create: `docs/dev-record-replay.md`
- Modify: `docs/ARCHITECTURE.md`, `docs/BUILD-LOG.md`, `CLAUDE.md`, `HANDOFF.md`

- [ ] **Step 1: Developer-facing feature doc (skill seed)**

Create `docs/dev-record-replay.md` with these sections (write real prose, no placeholders):
- **What it is** — record real provider runs once, replay instantly; speeds the dev loop.
- **How to use** — `DEV_RECORD_REPLAY=1 yarn dev` to record-then-replay; first run of each scenario is slow (real `claude`), subsequent runs instant. `DEV_RECORD_REPLAY=record` to force-refresh; or delete the agent's file under `apps/inbox/.cassettes/`.
- **How it works** — decorator around the real provider; key = `wf__agent` + step (resolved-approval count); one JSONL file per agent, line = `{step, event}`; replay-or-record per step.
- **Sharing a cassette — READ THIS** — recordings hold real captured data; never commit `.cassettes/`; before sharing, the agent must warn + run the safety scan (`scanCassette`) and highlight findings; the human is the final reviewer.
- **Note:** "This page is the seed of the workflow-developer skill."

- [ ] **Step 2: ARCHITECTURE.md**

Add a subsection under the providers/dev-tooling area describing the record/replay layer, marked **BUILT** (it is, after Tasks 1-6), cross-linking the spec and `docs/dev-record-replay.md`.

- [ ] **Step 3: BUILD-LOG.md**

Add the next numbered section (`§10`) narrating what was built: `resolvedApprovalCount`, the JSONL cassette store, `scanCassette`, the `withRecordReplay` decorator, the `build-agent` wiring, and the `DEV_RECORD_REPLAY` toggle. Follow the existing per-feature narrative style.

- [ ] **Step 4: CLAUDE.md — two stable rules**

Under "Don't-rediscover gotchas", add:
- **Dev record/replay loop:** `DEV_RECORD_REPLAY=1` wraps every agent's provider in a record/replay decorator (`apps/inbox/server/record-replay.ts`); cassettes are one JSONL per `wf__agent` under `apps/inbox/.cassettes/` (gitignored), keyed by step (= resolved-approval count). Delete a file or use `=record` to refresh after a prompt change. Unset = pure production path.
- **Cassette share-safety (HARD RULE):** a cassette holds REAL captured email/ticket data. Whenever the user asks to commit/push/share/un-gitignore a cassette, the agent MUST (1) warn, (2) run `scanCassette` over the file(s) and report every finding with `file:line`, (3) wait for the user to confirm/scrub. Never share a cassette silently. Names/addresses aren't regex-detectable — the human is the final reviewer.

- [ ] **Step 5: HANDOFF.md**

Update "Where we are now": dev record/replay BUILT on `feat/dev-record-replay`; summarize and link spec/plan/BUILD-LOG §10.

- [ ] **Step 6: Format + commit**

Run: `yarn format`

```bash
git add docs/ CLAUDE.md HANDOFF.md
git commit -m "docs(record-replay): feature doc, architecture/build-log, CLAUDE rules (incl. share-safety), handoff"
```

---

## Task 8: Full-suite verification + browser E2E

**Files:** none (verification only).

- [ ] **Step 1: Full suite**

Run: `yarn test && yarn typecheck && yarn lint && yarn format:check`
Expected: all green; the new `resolvedApprovalCount` + `record-replay` tests included.

- [ ] **Step 2: Browser E2E — record then replay (per the project's hard rule)**

Before starting: kill stale dev stacks and free ports per CLAUDE.md
(`pkill -9 -f "AiWorkflow/node_modules/.bin/(tsx|vite|concurrently)"`,
`lsof -tiTCP:4000,:5173,:5174 | xargs kill -9`), confirm one server on `:4000` + one vite on `:5173`.

1. `DEV_RECORD_REPLAY=1 yarn dev`. Open the Lead inbox workflow, run the qualifier→reply path through to the approval, click approve. First run hits real `claude` (slow). Confirm cards render and `apps/inbox/.cassettes/` now has the agents' `.jsonl` files with `{step,…}` lines for step 0 and step 1.
2. Re-run the same path. Expected: **instant** (no ~30s wait), identical cards, HITL approve still flips step 1 to the recorded "draft saved" — and **no page reload** throughout.
3. `DEV_RECORD_REPLAY=record yarn dev`, re-run: confirm it hits real `claude` again and overwrites the files.

- [ ] **Step 3: Verify the share-safety scan behaves**

In a scratch check, run `scanCassette` over a recorded `.jsonl` (e.g. a tiny vitest or node one-off) and confirm it flags the real sender email present in the recording. This proves the safety net fires on real data.

- [ ] **Step 4: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to choose merge/PR/cleanup. Do not merge to `main`/`master` without the user's go-ahead (project rule).

---

## Self-review notes

- **Spec coverage:** decorator (T5/T6), env toggle (T5/T6), `wf__agent`+step key (T1/T5), per-step replay-or-record (T5), JSONL one-file-per-agent variant A (T2/T4), gitignore (T6), `scanCassette` share-safety (T3) + the hard agent rule (T7 CLAUDE.md), docs/skill-seed deliverables (T7), testing incl. browser E2E (T8). All spec sections map to a task.
- **Type consistency:** `resolvedApprovalCount(messages, approvalNames): number`, `CassetteStore(dir, key)` with `readStep(step): Promise<BaseEvent[]|null>` / `writeStep(step, events)`, `withRecordReplay(provider, {key, approvalNames, dir, mode})`, `recordReplayMode(): 'replay'|'record'|null`, `cassettesDir(): string`, `scanCassette(text): Finding[]`, `buildAgent(def, prompts, registry, allowedTools, instanceKey)` — names used identically across tasks.
- **No placeholders:** every code/test step shows the actual code and the exact command + expected result.
