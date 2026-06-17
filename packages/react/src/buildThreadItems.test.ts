import { describe, expect, it } from 'vitest'
import type { Message } from '@atizar/core'
import { buildThreadItems } from './buildThreadItems.js'

const opts = { renderableToolNames: new Set<string>(), devMode: false }

describe('buildThreadItems', () => {
  it('preserves message order: text then lifecycle', () => {
    const messages = [
      { id: 'a1', role: 'assistant', content: 'sorting' },
      { id: 'sys', role: 'system', content: 'Done' },
    ] as Message[]
    const items = buildThreadItems(messages, opts)
    expect(items.map((i) => i.kind)).toEqual(['text', 'lifecycle'])
  })

  it('skips non-renderable tool calls in non-dev mode', () => {
    const messages: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'tc1', function: { name: 'hidden_tool', arguments: '{}' }, type: 'function' },
        ],
      },
    ]
    const items = buildThreadItems(messages, opts)
    expect(items).toHaveLength(0)
  })

  it('includes tool calls that are in renderableToolNames', () => {
    const messages: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'tc1', function: { name: 'renderLead', arguments: '{}' }, type: 'function' },
        ],
      },
    ]
    const items = buildThreadItems(messages, {
      renderableToolNames: new Set(['renderLead']),
      devMode: false,
    })
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('toolCall')
  })

  it('includes all tool calls in devMode regardless of renderableToolNames', () => {
    const messages: Message[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'tc1', function: { name: 'hidden_tool', arguments: '{}' }, type: 'function' },
        ],
      },
    ]
    const items = buildThreadItems(messages, { renderableToolNames: new Set(), devMode: true })
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('toolCall')
  })

  it('skips empty assistant text', () => {
    const messages: Message[] = [{ id: 'a1', role: 'assistant', content: '' }]
    const items = buildThreadItems(messages, opts)
    expect(items).toHaveLength(0)
  })

  it('skips user messages', () => {
    const messages: Message[] = [{ id: 'u1', role: 'user', content: 'hello' }]
    const items = buildThreadItems(messages, opts)
    expect(items).toHaveLength(0)
  })

  it('places a handoff between text and report, and never above earlier text in a prefix', () => {
    const full = [
      { id: 'a1', role: 'assistant', content: 'sorting' },
      {
        id: 'handoff-c1',
        role: 'handoff',
        targetAgentId: 'wf__reply',
        childWorkItemId: 'c1',
        deduped: false,
      },
      { id: 'a2', role: 'assistant', content: 'summary' },
    ] as unknown as Message[]
    expect(buildThreadItems(full, opts).map((i) => i.kind)).toEqual(['text', 'handoff', 'text'])

    // streaming prefix: only the first two have arrived — handoff stays after the text, not floated up
    const prefix = full.slice(0, 2)
    expect(buildThreadItems(prefix, opts).map((i) => i.kind)).toEqual(['text', 'handoff'])
  })

  it('drops a deduped handoff from the timeline (no visible note)', () => {
    const messages = [
      {
        id: 'handoff-c2',
        role: 'handoff',
        targetAgentId: 'wf__reader',
        childWorkItemId: 'c2',
        deduped: true,
      },
    ] as unknown as Message[]
    expect(buildThreadItems(messages, opts)).toHaveLength(0)
  })
})
