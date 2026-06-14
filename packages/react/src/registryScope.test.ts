import { describe, it, expect } from 'vitest'
import { byWorkflow, renderableNamesFor } from './registryScope'
import type { RenderSpec, HitlSpec } from './renderSpecs'
import type { WorkflowsConfig } from './workflowsContext'

// Minimal RenderSpec stubs — render is irrelevant to the scoping logic, so a no-op.
const r = (workflowId: string, toolName: string): RenderSpec =>
  ({ workflowId, toolName, parameters: {}, render: () => null }) as unknown as RenderSpec
const h = (workflowId: string, toolName: string): HitlSpec =>
  ({ workflowId, toolName, parameters: {}, render: () => null }) as unknown as HitlSpec

describe('byWorkflow', () => {
  it('returns only the specs of the given workflow', () => {
    const specs = [r('wf-a', 'shared'), r('wf-b', 'shared'), r('wf-a', 'onlyA')]
    const a = byWorkflow(specs, 'wf-a')
    expect(a).toHaveLength(2)
    expect(a.map((s) => s.toolName).sort()).toEqual(['onlyA', 'shared'])
    expect(byWorkflow(specs, 'wf-b')).toHaveLength(1)
    expect(byWorkflow(specs, 'wf-b')[0].workflowId).toBe('wf-b')
  })

  it('returns [] for an unknown workflow', () => {
    expect(byWorkflow([r('wf-a', 'x')], 'nope')).toEqual([])
  })
})

describe('renderableNamesFor', () => {
  it('unions render + HITL tool names scoped to one workflow', () => {
    const config = {
      renders: [r('wf-a', 'renderLead'), r('wf-b', 'renderLead'), r('wf-a', 'renderSort')],
      hitl: [h('wf-a', 'saveDraft'), h('wf-b', 'applyActions')],
    } as unknown as WorkflowsConfig
    const a = renderableNamesFor(config, 'wf-a')
    expect([...a].sort()).toEqual(['renderLead', 'renderSort', 'saveDraft'])
    const b = renderableNamesFor(config, 'wf-b')
    expect([...b].sort()).toEqual(['applyActions', 'renderLead'])
    // wf-b must NOT see wf-a's saveDraft / renderSort.
    expect(b.has('saveDraft')).toBe(false)
    expect(b.has('renderSort')).toBe(false)
  })
})
