import { describe, it, expect } from 'vitest'
import { activePipeline, type PipelineNode } from './pipeline'
import type { Status } from './status'

const node = (id: string, status: Status, handoffsTo: string[] = []): PipelineNode => ({
  id,
  name: id.toUpperCase(),
  subtitle: '',
  iconName: 'inbox',
  status,
  handoffsTo,
})

describe('activePipeline', () => {
  it('shows a running agent', () => {
    expect(activePipeline([node('reply', 'running')]).map((n) => n.id)).toEqual(['reply'])
  })

  it('drops an idle agent (not launched)', () => {
    expect(activePipeline([node('reply', 'idle')])).toEqual([])
  })

  it('drops a done agent with no active subagent', () => {
    const result = activePipeline([node('qualifier', 'done', ['reply']), node('reply', 'done')])
    expect(result).toEqual([])
  })

  it('keeps a done parent while its handoff subagent is active, shown as Working', () => {
    const result = activePipeline([
      node('qualifier', 'done', ['reply']),
      node('reply', 'awaiting_approval'),
    ])
    expect(result.map((n) => n.id)).toEqual(['qualifier', 'reply'])
    // The caller is displayed as running while its subagent works...
    expect(result.find((n) => n.id === 'qualifier')?.status).toBe('running')
    // ...but the active subagent keeps its real status.
    expect(result.find((n) => n.id === 'reply')?.status).toBe('awaiting_approval')
  })

  it('promotes ancestors transitively along a handoff chain', () => {
    const result = activePipeline([
      node('a', 'done', ['b']),
      node('b', 'done', ['c']),
      node('c', 'running'),
    ])
    expect(result.map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(result.find((n) => n.id === 'a')?.status).toBe('running')
    expect(result.find((n) => n.id === 'b')?.status).toBe('running')
  })

  it('keeps an error agent (needs attention)', () => {
    const result = activePipeline([node('qualifier', 'error'), node('reply', 'idle')])
    expect(result.map((n) => n.id)).toEqual(['qualifier'])
  })

  it('orders a handoff source before its target, regardless of input order', () => {
    const result = activePipeline([
      node('reply', 'awaiting_approval'),
      node('qualifier', 'running', ['reply']),
    ])
    expect(result.map((n) => n.id)).toEqual(['qualifier', 'reply'])
  })

  it('is empty when nothing is launched', () => {
    expect(activePipeline([node('qualifier', 'idle'), node('reply', 'idle')])).toEqual([])
  })

  it('does not loop forever on a cycle', () => {
    const result = activePipeline([node('a', 'running', ['b']), node('b', 'running', ['a'])])
    expect(result.map((n) => n.id).sort()).toEqual(['a', 'b'])
  })
})
