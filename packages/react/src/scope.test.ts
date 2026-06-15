import { describe, it, expect } from 'vitest'
import { scope } from './scope'

// A minimal spec shape — scope is generic over { toolName, workflowId }, so any object
// carrying a toolName works. workflowId is stamped on, so the input omits it.
type Spec = { toolName: string; workflowId: string; tag?: string }

describe('scope', () => {
  it('stamps the workflowId onto each spec', () => {
    const out = scope<Spec>('wf-a', [{ toolName: 'renderLead' }, { toolName: 'saveDraft' }])
    expect(out).toEqual([
      { toolName: 'renderLead', workflowId: 'wf-a' },
      { toolName: 'saveDraft', workflowId: 'wf-a' },
    ])
  })

  it('preserves other fields on each spec', () => {
    const out = scope<Spec>('wf-a', [{ toolName: 'renderLead', tag: 'x' }])
    expect(out[0]).toEqual({ toolName: 'renderLead', workflowId: 'wf-a', tag: 'x' })
  })

  it('drops duplicate tool names within the workflow, keeping the FIRST', () => {
    const out = scope<Spec>('wf-a', [
      { toolName: 'renderLead', tag: 'first' },
      { toolName: 'renderLead', tag: 'second' },
      { toolName: 'saveDraft' },
    ])
    expect(out).toHaveLength(2)
    expect(out.map((s) => s.toolName)).toEqual(['renderLead', 'saveDraft'])
    expect(out[0].tag).toBe('first')
  })

  it('returns [] for no specs', () => {
    expect(scope<Spec>('wf-a', [])).toEqual([])
  })
})
