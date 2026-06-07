import { describe, it, expect } from 'vitest'
import { EventType, type RunAgentInput } from '@ag-ui/client'
import { createClaudeCliProvider, type ClaudeSpawn } from './claude-cli-provider.js'
import { createReplyPrompts } from './agents/reply.prompts.js'

const line = (o: unknown) => JSON.stringify(o)
const textDelta = (t: string) => line({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } } })
const toolStart = (i: number, id: string, name: string) => line({ type: 'stream_event', event: { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id, name, input: {} } } })
const toolArgs = (i: number, p: string) => line({ type: 'stream_event', event: { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: p } } })
const stop = (i: number) => line({ type: 'stream_event', event: { type: 'content_block_stop', index: i } })

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
    const provider = createClaudeCliProvider({ approvalNames: ['saveDraft'], surfaceTools: ['renderLead', 'saveDraft'], prompts: createReplyPrompts('do it'), spawn })
    const out = await drain(provider.run(runInput([])))
    const callNames = out.filter((e) => e.type === EventType.TOOL_CALL_START).map((e) => e.toolCallName)
    expect(callNames).toEqual(['renderLead', 'saveDraft'])
    expect(out.at(-1)).toMatchObject({ type: EventType.TOOL_CALL_END, toolCallId: 'tc_ok' })
    expect(calls[0].killed).toBe(true)
    expect(calls[0].prompt).toContain('get_latest_email')
  })

  it('resume: when approval is resolved, re-primes and streams done text', async () => {
    const { spawn, calls } = fakeSpawn([{ when: () => true, lines: [textDelta('Done — reply sent.')] }])
    const provider = createClaudeCliProvider({ approvalNames: ['saveDraft'], surfaceTools: ['renderLead', 'saveDraft'], prompts: createReplyPrompts('do it'), spawn })
    const messages = [
      { role: 'assistant', toolCalls: [{ id: 'tc_ok', type: 'function', function: { name: 'saveDraft', arguments: '{"threadId":"t_1","body":"Hello"}' } }] },
      { role: 'tool', toolCallId: 'tc_ok', content: 'approved' },
    ]
    const out = await drain(provider.run(runInput(messages)))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ type: EventType.TEXT_MESSAGE_CHUNK, delta: 'Done — reply sent.' })
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
      prompts: createReplyPrompts('x'),
      spawn,
    })
    const messages = [
      {
        role: 'assistant',
        id: 'a1',
        toolCalls: [{ id: 'tc_d', type: 'function', function: { name: 'saveDraft', arguments: '{"threadId":"t_42","body":"Hi Ivan"}' } }],
      },
      { role: 'tool', id: 't1', content: 'approved', toolCallId: 'tc_d' },
    ]
    for await (const _ of provider.run(runInput(messages))) { /* drain */ }
    expect(seenPrompt).toContain('t_42')
    expect(seenPrompt).toContain('Hi Ivan')
    expect(seenPrompt).toContain('create_draft')
  })

  it('resume: surfaces an error when the thread has no usable draft args', async () => {
    let spawned = false
    const spawn: ClaudeSpawn = () => {
      spawned = true
      async function* lines() { /* no lines */ }
      return { lines: lines(), kill: () => {} }
    }
    const provider = createClaudeCliProvider({
      approvalNames: ['saveDraft'],
      surfaceTools: ['renderLead', 'saveDraft'],
      prompts: createReplyPrompts('x'),
      spawn,
    })
    // saveDraft call present (so approvalResolved is true) but args lack threadId/body
    const messages = [
      {
        role: 'assistant',
        id: 'a1',
        toolCalls: [{ id: 'tc_d', type: 'function', function: { name: 'saveDraft', arguments: '{}' } }],
      },
      { role: 'tool', id: 't1', content: 'approved', toolCallId: 'tc_d' },
    ]
    const out = await drain(provider.run(runInput(messages)))
    const errorEvent = out.find((e) => e.type === EventType.TEXT_MESSAGE_CHUNK && e.delta?.includes('Resume failed'))
    expect(errorEvent).toBeDefined()
    expect(spawned).toBe(false)
  })

  it('emits a readable error chunk when spawn throws', async () => {
    const spawn: ClaudeSpawn = () => { throw new Error('claude not found') }
    const provider = createClaudeCliProvider({ approvalNames: ['saveDraft'], surfaceTools: ['renderLead', 'saveDraft'], instructions: 'x', spawn })
    const out = await drain(provider.run(runInput([])))
    expect(out[0]).toMatchObject({ type: EventType.TEXT_MESSAGE_CHUNK })
    expect(out[0].delta).toMatch(/error/i)
  })
})
