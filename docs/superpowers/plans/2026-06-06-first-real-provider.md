# First Real Provider (`claude-cli`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a real Claude model behind the existing `Provider` seam — turn 1 streams text + `renderLead` + `confirmSend` then pauses (HITL); resume streams a short "done" — by spawning the `claude` CLI and mapping its stream-json output to AG-UI events.

**Architecture:** A pure parser (`mapClaudeStream`) turns `claude`'s NDJSON stream into AG-UI events and stops after the approval tool call. A pure provider factory (`createClaudeCliProvider`) wraps it with an injectable `spawn`; the real Node spawn + a stdio MCP server (exposing `renderLead`/`confirmSend`) live server-side. The client, transport, and message contract are unchanged.

**Tech Stack:** TypeScript, `@ag-ui/client` event types, `@modelcontextprotocol/sdk` (stdio MCP server), Node `child_process`, vitest.

---

## File Structure

- Create `apps/inbox/core/claude-stream.ts` — pure NDJSON→AG-UI parser (isomorphic, no Node).
- Create `apps/inbox/core/claude-stream.test.ts`
- Create `apps/inbox/core/claude-cli-provider.ts` — pure `Provider` factory, injectable `spawn` (no Node import).
- Create `apps/inbox/core/claude-cli-provider.test.ts`
- Create `apps/inbox/mcp/inbox-tools.mjs` — stdio MCP server (separate process).
- Create `apps/inbox/server/claude-spawn.ts` — real Node spawn + generated mcp-config/settings.
- Create `apps/inbox/server/providers.ts` — runtime registry (`mock` + `claude-cli`).
- Modify `apps/inbox/core/inbox.agent.ts` — passport `provider: 'claude-cli'`; drop the core registry export.
- Modify `apps/inbox/core/inbox.agent.test.ts` — stop asserting the removed core registry.
- Modify `apps/inbox/server/index.ts` — import registry from `./providers.js`.
- Modify `apps/inbox/package.json` — add `@modelcontextprotocol/sdk` dependency.

Conventions: `docs/CONVENTIONS.md` (core/server use `function` declarations; `type` not `interface`; no `any`).

---

## Task 0: Recon — pin exact CLI flags + MCP SDK API

No code change; verify against the installed tools so later tasks use real flags.

- [ ] **Step 1: Inspect the CLI flags**

Run: `claude --help 2>&1 | grep -iE "output-format|mcp-config|settings|partial|append-system|permission|^\s*-p|print|bare" `
Confirm the exact spelling of: `-p/--print`, `--output-format stream-json`, `--mcp-config`, `--settings`, `--include-partial-messages`, `--append-system-prompt`, and whether `--bare` exists. Note any differences from this plan and adjust the spawn args in Task 4 accordingly.

- [ ] **Step 2: Inspect the MCP SDK entry points**

Run: `node -e "const p=require('/Users/yaroshuk/Development/AiWorkflow/apps/inbox/node_modules/@modelcontextprotocol/sdk/package.json'); console.log(p.version, JSON.stringify(p.exports&&Object.keys(p.exports)))"`
Confirm the subpath for the server + stdio transport (expected `@modelcontextprotocol/sdk/server/mcp.js` and `.../server/stdio.js`, exporting `McpServer` / `StdioServerTransport`). If the API differs (older SDK uses `Server` + `setRequestHandler`), adjust Task 3's server code.

- [ ] **Step 3: Confirm auth posture**

Run: `printenv ANTHROPIC_API_KEY || echo unset`
Expected: `unset` (we rely on the Claude Code subscription login). The spawn (Task 4) deletes `ANTHROPIC_API_KEY` from the child env regardless.

No commit (recon only).

---

## Task 1: Pure stream parser `mapClaudeStream`

**Files:**
- Create: `apps/inbox/core/claude-stream.ts`
- Test: `apps/inbox/core/claude-stream.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/inbox/core/claude-stream.test.ts
import { describe, it, expect } from 'vitest'
import { EventType } from '@ag-ui/client'
import { mapClaudeStream } from './claude-stream.js'

async function* fromLines(lines: string[]) {
  for (const l of lines) yield l
}

async function collect(lines: string[], approvalNames: string[]) {
  const out: any[] = []
  for await (const ev of mapClaudeStream(fromLines(lines), { approvalNames })) out.push(ev)
  return out
}

const textDelta = (t: string) =>
  JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } } })
const toolStart = (index: number, id: string, name: string) =>
  JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name, input: {} } } })
const toolArgs = (index: number, partial: string) =>
  JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: partial } } })
const blockStop = (index: number) =>
  JSON.stringify({ type: 'stream_event', event: { type: 'content_block_stop', index } })

describe('mapClaudeStream', () => {
  it('maps text deltas to TEXT_MESSAGE_CHUNK', async () => {
    const out = await collect([textDelta('Hello '), textDelta('world')], ['confirmSend'])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ type: EventType.TEXT_MESSAGE_CHUNK, role: 'assistant', delta: 'Hello ' })
    expect(out[1]).toMatchObject({ delta: 'world' })
  })

  it('maps a tool call (mcp prefix stripped) to START/ARGS/END', async () => {
    const out = await collect(
      [toolStart(0, 'tc1', 'mcp__inbox__renderLead'), toolArgs(0, '{"id":42}'), blockStop(0)],
      ['confirmSend'],
    )
    expect(out[0]).toMatchObject({ type: EventType.TOOL_CALL_START, toolCallId: 'tc1', toolCallName: 'renderLead' })
    expect(out[1]).toMatchObject({ type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc1', delta: '{"id":42}' })
    expect(out[2]).toMatchObject({ type: EventType.TOOL_CALL_END, toolCallId: 'tc1' })
  })

  it('STOPS after the approval tool call ends (no further events)', async () => {
    const out = await collect(
      [
        textDelta('found a lead'),
        toolStart(0, 'tc_lead', 'mcp__inbox__renderLead'),
        blockStop(0),
        toolStart(1, 'tc_ok', 'mcp__inbox__confirmSend'),
        toolArgs(1, '{"leadId":42,"message":"ok?"}'),
        blockStop(1),
        textDelta('THIS MUST NOT APPEAR'),
      ],
      ['confirmSend'],
    )
    const names = out.map((e) => e.type)
    expect(names).toContain(EventType.TOOL_CALL_END)
    // confirmSend END is the last event; the trailing text is never mapped.
    expect(out.some((e) => e.delta === 'THIS MUST NOT APPEAR')).toBe(false)
    expect(out.at(-1)).toMatchObject({ type: EventType.TOOL_CALL_END, toolCallId: 'tc_ok' })
  })

  it('skips malformed lines and blanks', async () => {
    const out = await collect(['', 'not json', '{bad', textDelta('ok')], ['confirmSend'])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ delta: 'ok' })
  })

  it('emits args from content_block_start.input when no input_json_delta arrives', async () => {
    const start = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc1', name: 'mcp__inbox__renderLead', input: { id: 42 } } },
    })
    const out = await collect([start, blockStop(0)], ['confirmSend'])
    expect(out.map((e) => e.type)).toEqual([EventType.TOOL_CALL_START, EventType.TOOL_CALL_ARGS, EventType.TOOL_CALL_END])
    expect(out[1]).toMatchObject({ toolCallId: 'tc1', delta: '{"id":42}' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/inbox && npx vitest run core/claude-stream.test.ts`
Expected: FAIL — `mapClaudeStream` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/inbox/core/claude-stream.ts
import { EventType, type BaseEvent } from '@ag-ui/client'

// Claude Code MCP tools surface as `mcp__<server>__<tool>`; the client registered
// the bare names (`renderLead`, `confirmSend`), so strip the prefix.
function stripMcpPrefix(name: string): string {
  if (!name.startsWith('mcp__')) return name
  const rest = name.slice('mcp__'.length)
  const sep = rest.indexOf('__')
  return sep === -1 ? name : rest.slice(sep + 2)
}

type ToolBlock = { id: string; name: string; sawArgs: boolean; startInput: unknown }

// Parses the `claude --output-format stream-json` NDJSON stream into AG-UI events.
// Stops (returns) right after emitting TOOL_CALL_END for an approval tool — the
// caller then kills the subprocess (turn-1 HITL pause).
export async function* mapClaudeStream(
  lines: AsyncIterable<string>,
  opts: { approvalNames: readonly string[] },
): AsyncGenerator<BaseEvent> {
  const blocks = new Map<number, ToolBlock>()

  for await (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    const obj = parsed as { type?: string; event?: Record<string, unknown> }
    if (obj.type !== 'stream_event' || !obj.event) continue
    const ev = obj.event as {
      type?: string
      index?: number
      content_block?: { type?: string; id?: string; name?: string; input?: unknown }
      delta?: { type?: string; text?: string; partial_json?: string }
    }
    const index = typeof ev.index === 'number' ? ev.index : -1

    if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
      const id = ev.content_block.id ?? crypto.randomUUID()
      const name = stripMcpPrefix(ev.content_block.name ?? '')
      blocks.set(index, { id, name, sawArgs: false, startInput: ev.content_block.input })
      yield {
        type: EventType.TOOL_CALL_START,
        toolCallId: id,
        toolCallName: name,
        parentMessageId: crypto.randomUUID(),
      } as BaseEvent
      continue
    }

    if (ev.type === 'content_block_delta') {
      if (ev.delta?.type === 'text_delta' && ev.delta.text) {
        yield {
          type: EventType.TEXT_MESSAGE_CHUNK,
          role: 'assistant',
          messageId: crypto.randomUUID(),
          delta: ev.delta.text,
        } as BaseEvent
        continue
      }
      if (ev.delta?.type === 'input_json_delta' && typeof ev.delta.partial_json === 'string') {
        const block = blocks.get(index)
        if (block) {
          block.sawArgs = true
          yield { type: EventType.TOOL_CALL_ARGS, toolCallId: block.id, delta: ev.delta.partial_json } as BaseEvent
        }
        continue
      }
      continue
    }

    if (ev.type === 'content_block_stop') {
      const block = blocks.get(index)
      if (!block) continue
      // Fall back to the start.input object if no streamed args arrived.
      if (!block.sawArgs && block.startInput && typeof block.startInput === 'object' && Object.keys(block.startInput as object).length > 0) {
        yield { type: EventType.TOOL_CALL_ARGS, toolCallId: block.id, delta: JSON.stringify(block.startInput) } as BaseEvent
      }
      yield { type: EventType.TOOL_CALL_END, toolCallId: block.id } as BaseEvent
      blocks.delete(index)
      if (opts.approvalNames.includes(block.name)) return
      continue
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/inbox && npx vitest run core/claude-stream.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/core/claude-stream.ts apps/inbox/core/claude-stream.test.ts
git commit -m "feat(core): stream-json -> AG-UI parser for the claude provider"
```

---

## Task 2: Provider factory `createClaudeCliProvider`

**Files:**
- Create: `apps/inbox/core/claude-cli-provider.ts`
- Test: `apps/inbox/core/claude-cli-provider.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/inbox/core/claude-cli-provider.test.ts
import { describe, it, expect } from 'vitest'
import { EventType, type RunAgentInput } from '@ag-ui/client'
import { createClaudeCliProvider, type ClaudeSpawn } from './claude-cli-provider.js'

const line = (o: unknown) => JSON.stringify(o)
const textDelta = (t: string) => line({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } } })
const toolStart = (i: number, id: string, name: string) => line({ type: 'stream_event', event: { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id, name, input: {} } } })
const toolArgs = (i: number, p: string) => line({ type: 'stream_event', event: { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: p } } })
const stop = (i: number) => line({ type: 'stream_event', event: { type: 'content_block_stop', index: i } })

// A fake spawn: records the prompt it was given, yields canned lines, tracks kill.
function fakeSpawn(scriptByContains: Array<{ when: (p: string) => boolean; lines: string[] }>) {
  const calls: { prompt: string; killed: boolean }[] = []
  const spawn: ClaudeSpawn = (prompt) => {
    const rec = { prompt, killed: false }
    calls.push(rec)
    const script = scriptByContains.find((s) => s.when(prompt))?.lines ?? []
    async function* lines() {
      for (const l of script) yield l
    }
    return { lines: lines(), kill: () => { rec.killed = true } }
  }
  return { spawn, calls }
}

const runInput = (messages: unknown[]): RunAgentInput => ({ messages } as unknown as RunAgentInput)

async function drain(it: AsyncIterable<any>) {
  const out: any[] = []
  for await (const e of it) out.push(e)
  return out
}

describe('createClaudeCliProvider', () => {
  it('turn 1: streams text + renderLead + confirmSend, then stops and kills', async () => {
    const { spawn, calls } = fakeSpawn([
      {
        when: () => true,
        lines: [
          textDelta('Checking inbox… found a lead.'),
          toolStart(0, 'tc_lead', 'mcp__inbox__renderLead'),
          toolArgs(0, '{"id":42}'),
          stop(0),
          toolStart(1, 'tc_ok', 'mcp__inbox__confirmSend'),
          toolArgs(1, '{"leadId":42,"message":"Send a reply?"}'),
          stop(1),
        ],
      },
    ])
    const provider = createClaudeCliProvider({ approvalNames: ['confirmSend'], instructions: 'do it', spawn })
    const out = await drain(provider.run(runInput([])))
    const callNames = out.filter((e) => e.type === EventType.TOOL_CALL_START).map((e) => e.toolCallName)
    expect(callNames).toEqual(['renderLead', 'confirmSend'])
    expect(out.at(-1)).toMatchObject({ type: EventType.TOOL_CALL_END, toolCallId: 'tc_ok' })
    expect(calls[0].killed).toBe(true)
  })

  it('resume: when approval is resolved, re-primes and streams done text', async () => {
    const { spawn, calls } = fakeSpawn([{ when: () => true, lines: [textDelta('Done — reply sent.')] }])
    const provider = createClaudeCliProvider({ approvalNames: ['confirmSend'], instructions: 'do it', spawn })
    const messages = [
      { role: 'assistant', toolCalls: [{ id: 'tc_ok', function: { name: 'confirmSend' } }] },
      { role: 'tool', toolCallId: 'tc_ok' },
    ]
    const out = await drain(provider.run(runInput(messages)))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ type: EventType.TEXT_MESSAGE_CHUNK, delta: 'Done — reply sent.' })
    expect(calls[0].prompt).toMatch(/APPROVED/)
  })

  it('emits a readable error chunk when spawn throws', async () => {
    const spawn: ClaudeSpawn = () => { throw new Error('claude not found') }
    const provider = createClaudeCliProvider({ approvalNames: ['confirmSend'], instructions: 'x', spawn })
    const out = await drain(provider.run(runInput([])))
    expect(out[0]).toMatchObject({ type: EventType.TEXT_MESSAGE_CHUNK })
    expect(out[0].delta).toMatch(/error/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/inbox && npx vitest run core/claude-cli-provider.test.ts`
Expected: FAIL — `createClaudeCliProvider` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/inbox/core/claude-cli-provider.ts
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import type { Provider } from './providers.js'
import { approvalResolved, type Message } from './messages.js'
import { mapClaudeStream } from './claude-stream.js'

// The canned lead — placeholder for real Gmail data (next phase).
const LEAD = { id: 42, from: 'ivan@acme.ru', subject: 'Order: 10 units', intent: 'order' }

// Spawns a `claude` run for a prompt and exposes stdout as NDJSON lines + kill().
// Injectable so the Node implementation stays server-side and tests use a fake.
export type ClaudeSpawn = (prompt: string) => {
  lines: AsyncIterable<string>
  kill: () => void
}

function firstPrompt(instructions: string): string {
  return [
    instructions,
    '',
    `Inbox (one new email): ${JSON.stringify(LEAD)}`,
    '',
    'Call renderLead with that email to surface it to the user, then call',
    'confirmSend with { leadId, message } to ask the human before replying.',
    'Do not send anything yourself.',
  ].join('\n')
}

function resumePrompt(instructions: string): string {
  return [
    instructions,
    '',
    `You surfaced this lead: ${JSON.stringify(LEAD)} and asked the human to`,
    'confirm sending a reply. The human APPROVED. Reply with one short sentence',
    'confirming the reply was sent. Do not call any tools.',
  ].join('\n')
}

function errorChunk(message: string): BaseEvent {
  return {
    type: EventType.TEXT_MESSAGE_CHUNK,
    role: 'assistant',
    messageId: crypto.randomUUID(),
    delta: `Provider error: ${message}`,
  } as BaseEvent
}

export function createClaudeCliProvider(opts: {
  approvalNames: readonly string[]
  instructions: string
  spawn: ClaudeSpawn
}): Provider {
  const { approvalNames, instructions, spawn } = opts
  return {
    async *run(input: RunAgentInput): AsyncIterable<BaseEvent> {
      const messages = (input?.messages ?? []) as Message[]
      const resuming = approvalResolved(messages, approvalNames)
      let child: { lines: AsyncIterable<string>; kill: () => void } | undefined
      try {
        child = spawn(resuming ? resumePrompt(instructions) : firstPrompt(instructions))
      } catch (err) {
        yield errorChunk(err instanceof Error ? err.message : String(err))
        return
      }
      try {
        // On resume no tool calls are expected; pass no approval names so the
        // parser never short-circuits.
        yield* mapClaudeStream(child.lines, { approvalNames: resuming ? [] : approvalNames })
      } catch (err) {
        yield errorChunk(err instanceof Error ? err.message : String(err))
      } finally {
        child.kill()
      }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/inbox && npx vitest run core/claude-cli-provider.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/core/claude-cli-provider.ts apps/inbox/core/claude-cli-provider.test.ts
git commit -m "feat(core): claude-cli Provider factory (injectable spawn, turn1+resume)"
```

---

## Task 3: stdio MCP server exposing the tools

**Files:**
- Create: `apps/inbox/mcp/inbox-tools.mjs`
- Modify: `apps/inbox/package.json` (add `@modelcontextprotocol/sdk`)

Use the SDK API confirmed in Task 0 Step 2. The code below assumes the current
`McpServer` + `registerTool` API; if Task 0 showed a different shape, adapt.

- [ ] **Step 1: Add the dependency**

Run: `cd apps/inbox && npm install @modelcontextprotocol/sdk`
Expected: package.json gains `@modelcontextprotocol/sdk` under dependencies.

- [ ] **Step 2: Write the MCP server**

```js
// apps/inbox/mcp/inbox-tools.mjs
// stdio MCP server launched by the `claude` CLI (--mcp-config). Exposes the two
// inbox tools so the model can CALL them. Handlers return trivial acks: the UI is
// driven by AG-UI events the provider emits from the stream, not by these results.
// confirmSend is rarely executed — the provider kills the run at the call.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'inbox', version: '1.0.0' })

server.registerTool(
  'renderLead',
  {
    description: 'Surface a lead email as a card in the UI.',
    inputSchema: { id: z.number(), from: z.string(), subject: z.string(), intent: z.string() },
  },
  async () => ({ content: [{ type: 'text', text: 'Lead surfaced to the user.' }] }),
)

server.registerTool(
  'confirmSend',
  {
    description: 'Ask the human to approve sending a reply to the lead.',
    inputSchema: { leadId: z.number(), message: z.string() },
  },
  async () => ({ content: [{ type: 'text', text: 'Awaiting human approval.' }] }),
)

await server.connect(new StdioServerTransport())
```

- [ ] **Step 3: Smoke-test the server speaks MCP over stdio**

Run:
```bash
cd apps/inbox && printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
'{"jsonrpc":"2.0","method":"notifications/initialized"}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node mcp/inbox-tools.mjs 2>/dev/null | grep -o '"name":"[a-zA-Z]*"'
```
Expected: output contains `"name":"renderLead"` and `"name":"confirmSend"`.
If the SDK API differs (no `registerTool`), fix per Task 0 findings and re-run.

- [ ] **Step 4: Commit**

```bash
git add apps/inbox/mcp/inbox-tools.mjs apps/inbox/package.json apps/inbox/package-lock.json
git commit -m "feat(mcp): stdio inbox-tools server (renderLead, confirmSend)"
```

---

## Task 4: Real Node spawn

**Files:**
- Create: `apps/inbox/server/claude-spawn.ts`

Use the exact flags confirmed in Task 0 Step 1. The args below are the expected
set; adjust spellings if recon differed.

- [ ] **Step 1: Write the spawn**

```ts
// apps/inbox/server/claude-spawn.ts
import { spawn as nodeSpawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ClaudeSpawn } from '../core/claude-cli-provider.js'

// Absolute path to the stdio MCP server script.
const MCP_SERVER = fileURLToPath(new URL('../mcp/inbox-tools.mjs', import.meta.url))

// Real spawn: writes a temp mcp-config + permission settings, runs `claude` in
// stream-json mode, exposes stdout as an async line iterator. Auth = the Claude
// Code subscription login; ANTHROPIC_API_KEY is removed so it can't override.
export const claudeSpawn: ClaudeSpawn = (prompt) => {
  const dir = mkdtempSync(join(tmpdir(), 'inbox-claude-'))
  const mcpConfig = join(dir, 'mcp.json')
  const settings = join(dir, 'settings.json')
  writeFileSync(
    mcpConfig,
    JSON.stringify({ mcpServers: { inbox: { type: 'stdio', command: 'node', args: [MCP_SERVER] } } }),
  )
  writeFileSync(
    settings,
    JSON.stringify({
      permissions: {
        allow: ['mcp__inbox__renderLead', 'mcp__inbox__confirmSend'],
        deny: ['Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
      },
    }),
  )

  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY

  const child = nodeSpawn(
    'claude',
    [
      '-p',
      prompt,
      '--mcp-config',
      mcpConfig,
      '--settings',
      settings,
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
    ],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  )

  const rl = createInterface({ input: child.stdout })
  return {
    lines: rl,
    kill: () => {
      try {
        child.kill('SIGKILL')
      } catch {
        // already gone
      }
    },
  }
}
```

- [ ] **Step 2: Typecheck compiles**

Run: `cd apps/inbox && npx tsc --noEmit`
Expected: no errors. (`readline.Interface` is `AsyncIterable<string>`, satisfying `ClaudeSpawn`.)

- [ ] **Step 3: Commit**

```bash
git add apps/inbox/server/claude-spawn.ts
git commit -m "feat(server): real claude subprocess spawn (stream-json + temp mcp/settings)"
```

---

## Task 5: Wire the registry and switch the passport

**Files:**
- Create: `apps/inbox/server/providers.ts`
- Modify: `apps/inbox/core/inbox.agent.ts`
- Modify: `apps/inbox/core/inbox.agent.test.ts`
- Modify: `apps/inbox/server/index.ts`

- [ ] **Step 1: Inspect what `inbox.agent.test.ts` asserts about the registry**

Run: `cd apps/inbox && grep -n "providerRegistry\|resolve\|mock" core/inbox.agent.test.ts`
Note which assertions reference the core `providerRegistry` so Step 4 can update them.

- [ ] **Step 2: Trim `core/inbox.agent.ts` to the passport only**

Replace the whole file with:

```ts
// apps/inbox/core/inbox.agent.ts
import { defineAgent } from './defineAgent.js'

// The inbox agent passport — single source of truth read by the server adapter
// and the client glue. The provider is resolved at runtime by the server's
// registry (see apps/inbox/server/providers.ts), which is why no registry is
// built here (the real provider needs Node and must stay off the client).
export const inboxAgent = defineAgent({
  id: 'inbox',
  name: 'EMAIL AGENT',
  provider: 'claude-cli',
  instructions: 'Check the inbox, surface a lead, and ask before replying.',
  tools: ['renderLead', 'confirmSend'],
  approvals: ['confirmSend'],
  renders: { renderLead: 'LeadCard', confirmSend: 'ApprovalDialog' },
})
```

- [ ] **Step 3: Create the server-side registry**

```ts
// apps/inbox/server/providers.ts
import { defineProviders, type ProviderRegistry } from '../core/providers.js'
import { createMockInboxProvider } from '../core/mock-provider.js'
import { createClaudeCliProvider } from '../core/claude-cli-provider.js'
import { inboxAgent } from '../core/inbox.agent.js'
import { claudeSpawn } from './claude-spawn.js'

// Runtime registry (server-only — claude-cli needs Node). The agent references a
// provider by name; `mock` stays available for fallback/manual testing.
export const providerRegistry: ProviderRegistry = defineProviders({
  mock: createMockInboxProvider(inboxAgent.approvals),
  'claude-cli': createClaudeCliProvider({
    approvalNames: inboxAgent.approvals,
    instructions: inboxAgent.instructions,
    spawn: claudeSpawn,
  }),
})
```

- [ ] **Step 4: Point `server/index.ts` at the new registry**

In `apps/inbox/server/index.ts`, change the import:

```ts
// before:
// import { inboxAgent, providerRegistry } from '../core/inbox.agent.js'
// after:
import { inboxAgent } from '../core/inbox.agent.js'
import { providerRegistry } from './providers.js'
```

(Leave the rest of `index.ts` unchanged — `buildAgent(inboxAgent, providerRegistry)` still works.)

- [ ] **Step 5: Update `inbox.agent.test.ts`**

Remove any assertions that import/exercise the removed core `providerRegistry`. Keep the passport-shape assertions. If the test only checked the passport, no change is needed; if it resolved `mock` from the core registry, move that into a new check that builds a registry locally, e.g.:

```ts
import { defineProviders } from './providers.js'
import { createMockInboxProvider } from './mock-provider.js'
import { inboxAgent } from './inbox.agent.js'

it('passport approvals drive a resolvable mock provider', () => {
  const reg = defineProviders({ mock: createMockInboxProvider(inboxAgent.approvals) })
  expect(reg.resolve('mock')).toBeDefined()
})
```

- [ ] **Step 6: Run the full unit suite + typecheck + lint**

Run: `cd apps/inbox && npx tsc --noEmit && npm test && npm run lint`
Expected: typecheck clean; all tests pass (28 existing + new parser/provider tests); lint exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/inbox/core/inbox.agent.ts apps/inbox/core/inbox.agent.test.ts apps/inbox/server/providers.ts apps/inbox/server/index.ts
git commit -m "feat: wire claude-cli provider; passport -> claude-cli; registry server-side"
```

---

## Task 6: End-to-end verification

**Files:** none (verification + docs).

- [ ] **Step 1: Start the dev server**

Run: `cd apps/inbox && npm run dev` (background). Wait for client :5173 and server :4000.

- [ ] **Step 2: Drive the real flow in a browser (Playwright MCP)**

Navigate to `http://localhost:5173`, click START. Expected real-model behavior:
- card: Idle → Working → **Awaiting approval**
- modal: assistant text + LeadCard (the canned lead) + ApprovalDialog
- click the approval → resume → a short "done" line; card → Done.

If `claude` is authenticated locally, this should pass. **If the run errors with an auth/login message** (subscription not logged in headlessly), record that real verification is pending an interactive `claude` login, and rely on the green unit suite. Do NOT mark the feature broken on an environment-auth issue — capture the exact error.

- [ ] **Step 3: Sanity-check the closed-card status path**

Confirm "Awaiting approval" shows on the CLOSED card before opening the modal (status is message-derived, render-independent — must still hold with the real provider).

- [ ] **Step 4: Update docs**

- `CLAUDE.md`: under Decisions, record the claude-cli provider (subprocess + stdio MCP, detect-and-kill HITL, stateless re-prime resume, server-side registry split). Update "Current State"/"Next Phase".
- `docs/ARCHITECTURE.md` §5: mark `claude-cli` BUILT; note the registry moved server-side.

- [ ] **Step 5: Commit docs**

```bash
git add CLAUDE.md docs/ARCHITECTURE.md
git commit -m "docs: record claude-cli provider as built"
```

---

## Notes for the implementer

- The client, transport, message layer, status derivation, and HITL contract are **unchanged** — do not touch them. The provider conforms to the existing two-request, client-held-pause contract.
- Keep `core/` Node-free: `claude-stream.ts` and `claude-cli-provider.ts` import only `@ag-ui/client` + sibling core modules. All `node:*` imports live in `server/` and `mcp/`.
- The MCP tool handlers are intentionally trivial — the UI is driven by AG-UI events the provider emits, not by tool results.
- If Task 0 reveals a different CLI flag or MCP API, adjust the affected task and note it in the commit message; the design intent is unchanged.
