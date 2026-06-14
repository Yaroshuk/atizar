import { describe, it, expect } from 'vitest'
import { PROVIDERS } from '@atizar/providers'
import { qualifierAgent, replyAgent as leadReply } from './lead-inbox/descriptor'
import {
  sorterAgent,
  replyAgent as emailReply,
  readerAgent,
  spamAgent,
  importantAgent,
} from './email-inbox/descriptor'
import {
  triageAgent,
  featureAgent,
  bugfixAgent,
  replyDraftAgent,
} from './github-triage/descriptor'

const ALL = [
  qualifierAgent,
  leadReply,
  sorterAgent,
  emailReply,
  readerAgent,
  spamAgent,
  importantAgent,
  triageAgent,
  featureAgent,
  bugfixAgent,
  replyDraftAgent,
]

describe('descriptors parse via defineAgent after the const refactor', () => {
  it('every agent resolves provider to the claude-cli wire string', () => {
    for (const a of ALL) {
      expect(a.provider).toBe(PROVIDERS.claudeCli)
      expect(a.provider).toBe('claude-cli')
    }
  })

  it('lead-inbox reply still declares saveDraft as tool + approval + effect', () => {
    expect(leadReply.tools).toContain('saveDraft')
    expect(leadReply.approvals).toContain('saveDraft')
    expect(leadReply.effects).toContain('saveDraft')
    expect(leadReply.renders.saveDraft).toBe('ApprovalDialog')
    expect(leadReply.renders.renderLead).toBe('LeadCard')
  })

  it('email-inbox sorter still declares route_emails as tool + dispatch', () => {
    expect(sorterAgent.tools).toContain('route_emails')
    expect(sorterAgent.dispatches).toContain('route_emails')
    expect(sorterAgent.renders.renderSort).toBe('SortSummaryCard')
  })

  it('github-triage triage still renders render_triage as TriageCard', () => {
    expect(triageAgent.tools).toContain('render_triage')
    expect(triageAgent.renders.render_triage).toBe('TriageCard')
  })
})
