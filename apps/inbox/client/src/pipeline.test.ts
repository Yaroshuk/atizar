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
  it('drops idle agents (only launched ones appear)', () => {
    const result = activePipeline([node('qualifier', 'idle'), node('reply', 'running')])
    expect(result.map((n) => n.id)).toEqual(['reply'])
  })

  it('orders a handoff source before its target, regardless of input order', () => {
    // reply listed first, but qualifier hands off TO reply -> qualifier must come first
    const result = activePipeline([
      node('reply', 'awaiting_approval'),
      node('qualifier', 'running', ['reply']),
    ])
    expect(result.map((n) => n.id)).toEqual(['qualifier', 'reply'])
  })

  it('keeps a single active node', () => {
    const result = activePipeline([node('qualifier', 'idle'), node('reply', 'awaiting_approval')])
    expect(result.map((n) => n.id)).toEqual(['reply'])
  })

  it('is empty when nothing is launched', () => {
    expect(activePipeline([node('qualifier', 'idle'), node('reply', 'idle')])).toEqual([])
  })

  it('does not loop forever on a cycle', () => {
    const result = activePipeline([node('a', 'running', ['b']), node('b', 'running', ['a'])])
    expect(result.map((n) => n.id).sort()).toEqual(['a', 'b'])
  })
})
