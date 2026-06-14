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

  it('keeps the reused saveDraft/applyActions HITL tool in EACH workflow that registers it', () => {
    // The reply agent is reused by lead-inbox AND email-inbox. Under the old global byName
    // dedup, only the first workflow's copy survived. Scoped, every registering workflow keeps
    // its own copy — that is the whole point of WS2.
    const leadHitl = byWorkflow(workflowsConfig.hitl, 'lead-inbox')
    const emailHitl = byWorkflow(workflowsConfig.hitl, 'email-inbox')
    expect(leadHitl.some((s) => s.toolName === 'saveDraft')).toBe(true)
    expect(emailHitl.some((s) => s.toolName === 'applyActions')).toBe(true)
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
