import { describe, it, expect } from 'vitest'
import { EventType, type RunAgentInput } from '@ag-ui/client'
import {
  decodeHandoff,
  HandoffPayloadSchema,
  readGateOpened,
  providerConformanceChecks,
  type ConformanceScenario,
  type ResumeHandle,
  type GateResolution,
  type PromptStrategy,
} from '@atizar/core'
import { createClaudeCliProvider, type ClaudeSpawn } from './claude-cli-provider.js'

// Local PromptStrategy fixture. The real reply-agent prompts live in the app
// (apps/inbox/core/agents) and move into their own package in a later task — the
// providers package must NOT depend on the app (that would be a backwards/cyclic
// dependency). This fixture reproduces the prompt SHAPE the provider relies on:
//   - standalone first turn (no handoff) → mentions the "qualifier" entry point
//   - resume turn → "APPROVED" + the saved threadId/body + a `create_draft` call
//   - resume returns null when threadId/body are missing (the "Resume failed" path)
const createReplyPrompts = (instructions: string): PromptStrategy => ({
  buildFirst(input: RunAgentInput): string {
    const h = decodeHandoff(input, HandoffPayloadSchema)
    if (h) {
      return [
        instructions,
        `A colleague already qualified this lead — category "${h.category}".`,
        `Email from ${h.from}, subject "${h.subject}". Summary: ${h.summary}`,
      ].join('\n')
    }
    return [
      instructions,
      'No lead has been handed off to you. Tell the user to start from the Lead',
      'Qualifier and click "Draft reply" on a verdict.',
    ].join('\n')
  },
  buildResume(args: Record<string, unknown>): string | null {
    const threadId = typeof args.threadId === 'string' ? args.threadId : ''
    const body = typeof args.body === 'string' ? args.body : ''
    if (!threadId || !body) return null
    return [
      instructions,
      'The human APPROVED saving this reply. Create it as a Gmail DRAFT now by',
      `calling create_draft, replying within thread "${threadId}", with body:`,
      body,
    ].join('\n')
  },
})

const line = (o: unknown) => JSON.stringify(o)
const textDelta = (t: string) =>
  line({
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } },
  })
const toolStart = (i: number, id: string, name: string) =>
  line({
    type: 'stream_event',
    event: {
      type: 'content_block_start',
      index: i,
      content_block: { type: 'tool_use', id, name, input: {} },
    },
  })
const toolArgs = (i: number, p: string) =>
  line({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index: i,
      delta: { type: 'input_json_delta', partial_json: p },
    },
  })
const stop = (i: number) =>
  line({ type: 'stream_event', event: { type: 'content_block_stop', index: i } })

function fakeSpawn(scriptByContains: Array<{ when: (p: string) => boolean; lines: string[] }>) {
  const calls: { prompt: string; killed: boolean }[] = []
  const spawn: ClaudeSpawn = (prompt) => {
    const rec = { prompt, killed: false }
    calls.push(rec)
    const script = scriptByContains.find((s) => s.when(prompt))?.lines ?? []
    async function* lines() {
      for (const l of script) yield l
    }
    return {
      lines: lines(),
      kill: () => {
        rec.killed = true
      },
    }
  }
  return { spawn, calls }
}

const runInput = (messages: unknown[]): RunAgentInput => ({ messages }) as unknown as RunAgentInput

async function drain(it: AsyncIterable<any>) {
  const out: any[] = []
  for await (const e of it) out.push(e)
  return out
}

describe('createClaudeCliProvider', () => {
  it('turn 1: streams text + renderLead + saveDraft, then stops and kills', async () => {
    const { spawn, calls } = fakeSpawn([
      {
        when: () => true,
        lines: [
          textDelta('Checking inbox… found a lead.'),
          toolStart(0, 'tc_lead', 'mcp__inbox__renderLead'),
          toolArgs(0, '{"id":42}'),
          stop(0),
          toolStart(1, 'tc_ok', 'mcp__inbox__saveDraft'),
          toolArgs(1, '{"threadId":"thread_demo","body":"Thanks for reaching out."}'),
          stop(1),
        ],
      },
    ])
    const provider = createClaudeCliProvider({
      approvalNames: ['saveDraft'],
      surfaceTools: ['renderLead', 'saveDraft'],
      allowedTools: ['mcp__inbox__renderLead', 'mcp__inbox__saveDraft', 'mcp__gmail__create_draft'],
      prompts: createReplyPrompts('do it'),
      spawn,
    })
    const out = await drain(provider.run(runInput([])))
    const callNames = out
      .filter((e) => e.type === EventType.TOOL_CALL_START)
      .map((e) => e.toolCallName)
    expect(callNames).toEqual(['renderLead', 'saveDraft'])
    expect(out.some((e) => e.type === EventType.TOOL_CALL_END && e.toolCallId === 'tc_ok')).toBe(
      true
    )
    // The run suspends at the gate: the LAST event is GATE_OPENED (right after the approval's END).
    expect(readGateOpened(out.at(-1))).not.toBeNull()
    expect(calls[0].killed).toBe(true)
    expect(calls[0].prompt).toMatch(/qualifier/i)
  })

  it('resume: when approval is resolved, re-primes and streams done text', async () => {
    const { spawn, calls } = fakeSpawn([
      { when: () => true, lines: [textDelta('Done — reply sent.')] },
    ])
    const provider = createClaudeCliProvider({
      approvalNames: ['saveDraft'],
      surfaceTools: ['renderLead', 'saveDraft'],
      allowedTools: ['mcp__inbox__renderLead', 'mcp__inbox__saveDraft', 'mcp__gmail__create_draft'],
      prompts: createReplyPrompts('do it'),
      spawn,
    })
    const messages = [
      {
        role: 'assistant',
        toolCalls: [
          {
            id: 'tc_ok',
            type: 'function',
            function: { name: 'saveDraft', arguments: '{"threadId":"t_1","body":"Hello"}' },
          },
        ],
      },
      { role: 'tool', toolCallId: 'tc_ok', content: 'approved' },
    ]
    const out = await drain(provider.run(runInput(messages)))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      type: EventType.TEXT_MESSAGE_CHUNK,
      delta: 'Done — reply sent.',
    })
    expect(calls[0].prompt).toMatch(/APPROVED/)
  })

  it('resume: re-primes from the saveDraft args in the thread', async () => {
    let seenPrompt = ''
    const spawn: ClaudeSpawn = (prompt) => {
      seenPrompt = prompt
      async function* lines() {
        yield textDelta('Draft saved to Gmail.')
      }
      return { lines: lines(), kill: () => {} }
    }
    const provider = createClaudeCliProvider({
      approvalNames: ['saveDraft'],
      surfaceTools: ['renderLead', 'saveDraft'],
      allowedTools: ['mcp__inbox__renderLead', 'mcp__inbox__saveDraft', 'mcp__gmail__create_draft'],
      prompts: createReplyPrompts('x'),
      spawn,
    })
    const messages = [
      {
        role: 'assistant',
        id: 'a1',
        toolCalls: [
          {
            id: 'tc_d',
            type: 'function',
            function: { name: 'saveDraft', arguments: '{"threadId":"t_42","body":"Hi Ivan"}' },
          },
        ],
      },
      { role: 'tool', id: 't1', content: 'approved', toolCallId: 'tc_d' },
    ]
    for await (const _ of provider.run(runInput(messages))) {
      /* drain */
    }
    expect(seenPrompt).toContain('t_42')
    expect(seenPrompt).toContain('Hi Ivan')
    expect(seenPrompt).toContain('create_draft')
  })

  it('resume: surfaces an error when the thread has no usable draft args', async () => {
    let spawned = false
    const spawn: ClaudeSpawn = () => {
      spawned = true
      async function* lines() {
        /* no lines */
      }
      return { lines: lines(), kill: () => {} }
    }
    const provider = createClaudeCliProvider({
      approvalNames: ['saveDraft'],
      surfaceTools: ['renderLead', 'saveDraft'],
      allowedTools: ['mcp__inbox__renderLead', 'mcp__inbox__saveDraft', 'mcp__gmail__create_draft'],
      prompts: createReplyPrompts('x'),
      spawn,
    })
    // saveDraft call present (so approvalResolved is true) but args lack threadId/body
    const messages = [
      {
        role: 'assistant',
        id: 'a1',
        toolCalls: [
          { id: 'tc_d', type: 'function', function: { name: 'saveDraft', arguments: '{}' } },
        ],
      },
      { role: 'tool', id: 't1', content: 'approved', toolCallId: 'tc_d' },
    ]
    const out = await drain(provider.run(runInput(messages)))
    const errorEvent = out.find(
      (e) => e.type === EventType.TEXT_MESSAGE_CHUNK && e.delta?.includes('Resume failed')
    )
    expect(errorEvent).toBeDefined()
    expect(spawned).toBe(false)
  })

  it('emits a readable error chunk when spawn throws', async () => {
    const spawn: ClaudeSpawn = () => {
      throw new Error('claude not found')
    }
    const provider = createClaudeCliProvider({
      approvalNames: ['saveDraft'],
      surfaceTools: ['renderLead', 'saveDraft'],
      allowedTools: ['mcp__inbox__renderLead', 'mcp__inbox__saveDraft', 'mcp__gmail__create_draft'],
      prompts: createReplyPrompts('x'),
      spawn,
    })
    const out = await drain(provider.run(runInput([])))
    expect(out[0]).toMatchObject({ type: EventType.TEXT_MESSAGE_CHUNK })
    expect(out[0].delta).toMatch(/error/i)
  })

  it('passes the agent allow-list through to spawn (the per-agent boundary)', async () => {
    let seen: { prompt: string; allowedTools: readonly string[] } | null = null
    const spawn: ClaudeSpawn = (prompt, allowedTools) => {
      seen = { prompt, allowedTools }
      async function* lines() {
        yield textDelta('ok')
      }
      return { lines: lines(), kill: () => {} }
    }
    const provider = createClaudeCliProvider({
      approvalNames: ['saveDraft'],
      surfaceTools: ['renderLead', 'saveDraft'],
      allowedTools: ['mcp__inbox__renderLead', 'mcp__gmail__create_draft'],
      prompts: createReplyPrompts('x'),
      spawn,
    })
    await drain(provider.run(runInput([])))
    expect(seen!.allowedTools).toEqual(['mcp__inbox__renderLead', 'mcp__gmail__create_draft'])
  })
})

describe('createClaudeCliProvider — resume()', () => {
  const baseOpts = {
    approvalNames: ['saveDraft'] as const,
    surfaceTools: ['renderLead', 'saveDraft'] as const,
    allowedTools: [
      'mcp__inbox__renderLead',
      'mcp__inbox__saveDraft',
      'mcp__gmail__create_draft',
    ] as const,
  }

  it('resume(approved) re-primes from resolution.form and streams done text', async () => {
    let seenPrompt = ''
    const spawn = (prompt: string) => {
      seenPrompt = prompt
      async function* lines() {
        yield textDelta('Draft saved to Gmail.')
      }
      return { lines: lines(), kill: () => {} }
    }
    const provider = createClaudeCliProvider({
      ...baseOpts,
      prompts: createReplyPrompts('x'),
      spawn,
    })
    const handle: ResumeHandle = { runId: 'r1', input: runInput([]) }
    const resolution: GateResolution = {
      gateId: 'g1',
      decision: 'approved',
      form: { threadId: 't_42', body: 'Hi Ivan' },
    }
    const out = await drain(provider.resume!(handle, resolution))
    expect(seenPrompt).toContain('t_42')
    expect(seenPrompt).toContain('Hi Ivan')
    expect(seenPrompt).toContain('APPROVED')
    expect(out[0]).toMatchObject({ delta: 'Draft saved to Gmail.' })
  })

  it('resume(rejected) yields a no-effect note and does NOT spawn', async () => {
    let spawned = false
    const spawn = () => {
      spawned = true
      async function* lines() {}
      return { lines: lines(), kill: () => {} }
    }
    const provider = createClaudeCliProvider({
      ...baseOpts,
      prompts: createReplyPrompts('x'),
      spawn,
    })
    const handle: ResumeHandle = { runId: 'r1', input: runInput([]) }
    const out = await drain(provider.resume!(handle, { gateId: 'g1', decision: 'rejected' }))
    expect(spawned).toBe(false)
    // Assert the exact no-effect note (not just any text containing "reject"), so a spawn-error
    // chunk that happened to mention "rejected" couldn't satisfy this.
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      type: EventType.TEXT_MESSAGE_CHUNK,
      delta: 'The human rejected the proposed action; no changes were made.',
    })
  })

  it('resume(approved) errors (no spawn) when no usable draft args exist', async () => {
    let spawned = false
    const spawn = () => {
      spawned = true
      async function* lines() {}
      return { lines: lines(), kill: () => {} }
    }
    const provider = createClaudeCliProvider({
      ...baseOpts,
      prompts: createReplyPrompts('x'),
      spawn,
    })
    const handle: ResumeHandle = { runId: 'r1', input: runInput([]) }
    const out = await drain(
      provider.resume!(handle, { gateId: 'g1', decision: 'approved', form: {} })
    )
    expect(spawned).toBe(false)
    expect(out.some((e) => /Resume failed/.test(e.delta ?? ''))).toBe(true)
  })
})

describe('createClaudeCliProvider conformance', () => {
  const scenario: ConformanceScenario = {
    approvalNames: ['saveDraft'],
    surfaceTools: ['renderLead', 'saveDraft'],
    turn1Input: runInput([]),
    approved: {
      handle: { runId: 'r1', input: runInput([]) },
      resolution: {
        gateId: 'g1',
        decision: 'approved',
        form: { threadId: 't_42', body: 'Hi Ivan' },
      },
    },
    rejected: {
      handle: { runId: 'r1', input: runInput([]) },
      resolution: { gateId: 'g1', decision: 'rejected' },
    },
  }
  const makeProvider = () =>
    createClaudeCliProvider({
      approvalNames: ['saveDraft'],
      surfaceTools: ['renderLead', 'saveDraft'],
      allowedTools: ['mcp__inbox__renderLead', 'mcp__inbox__saveDraft', 'mcp__gmail__create_draft'],
      prompts: createReplyPrompts('do it'),
      spawn: fakeSpawn([
        { when: (p) => /APPROVED/.test(p), lines: [textDelta('Draft saved to Gmail.')] },
        {
          when: () => true,
          lines: [
            textDelta('Checking inbox… found a lead.'),
            toolStart(0, 'tc_lead', 'mcp__inbox__renderLead'),
            toolArgs(0, '{"id":42}'),
            stop(0),
            toolStart(1, 'tc_ok', 'mcp__inbox__saveDraft'),
            toolArgs(1, '{"threadId":"t_42","body":"Hi"}'),
            stop(1),
          ],
        },
      ]).spawn,
    })
  for (const check of providerConformanceChecks) {
    it(check.name, () => check.run(makeProvider, scenario))
  }
})
