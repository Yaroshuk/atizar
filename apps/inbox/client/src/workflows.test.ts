import { describe, it, expect } from 'vitest'
import { workflowsConfig } from './workflows'
import { byWorkflow } from '@atizar/react'

describe('workflowsConfig render/HITL scoping', () => {
  it('stamps every render spec with a workflowId', () => {
    expect(workflowsConfig.renders.length).toBeGreaterThan(0)
    for (const s of workflowsConfig.renders) {
      expect(typeof s.workflowId).toBe('string')
      expect(s.workflowId.length).toBeGreaterThan(0)
    }
  })

  it('stamps every HITL spec with a workflowId', () => {
    expect(workflowsConfig.hitl.length).toBeGreaterThan(0)
    for (const s of workflowsConfig.hitl) {
      expect(typeof s.workflowId).toBe('string')
      expect(s.workflowId.length).toBeGreaterThan(0)
    }
  })

  it('email-inbox self-registers both its reply HITL (saveDraft) and its batch HITL (applyActions)', () => {
    // The reply contract (saveDraft) is registered by email-inbox ITSELF — resolution is scoped
    // per workflow (WS2), so email-inbox must own its copy or the reply agent's approval card
    // vanishes. applyActions is the batch gate. Both must be present under email-inbox.
    const emailHitl = byWorkflow(workflowsConfig.hitl, 'email-inbox')
    expect(emailHitl.some((s) => s.toolName === 'saveDraft')).toBe(true)
    expect(emailHitl.some((s) => s.toolName === 'applyActions')).toBe(true)
  })

  it('email-inbox self-registers the reply card renders (renderLead) alongside renderSort', () => {
    const emailRenders = byWorkflow(workflowsConfig.renders, 'email-inbox')
    expect(emailRenders.some((s) => s.toolName === 'renderLead')).toBe(true)
    expect(emailRenders.some((s) => s.toolName === 'renderSort')).toBe(true)
  })

  it('dedups WITHIN a workflow (no duplicate toolName for the same workflow)', () => {
    const seen = new Set<string>()
    for (const s of workflowsConfig.renders) {
      const key = `${s.workflowId}:${s.toolName}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })
})
