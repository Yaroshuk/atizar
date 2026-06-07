import { describe, it, expect } from 'vitest'
import {
  triageAgent,
  featureAgent,
  bugfixAgent,
  replyDraftAgent,
  githubAgents,
} from './github.agent.js'

describe('github agents', () => {
  it('only triage reads the board', () => {
    expect(triageAgent.tools).toContain('list_my_tickets')
    for (const a of [featureAgent, bugfixAgent, replyDraftAgent]) {
      expect(a.tools).not.toContain('list_my_tickets')
      expect(a.tools).not.toContain('get_ticket')
    }
  })

  it('no agent has any approval (read-only flow has no write to pause)', () => {
    for (const a of githubAgents) expect(a.approvals).toEqual([])
  })

  it('triage hands off to the three downstream agents', () => {
    expect(triageAgent.handoffs).toEqual(['feature', 'bugfix', 'reply-draft'])
  })
})
