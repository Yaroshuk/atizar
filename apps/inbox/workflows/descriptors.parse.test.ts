import { describe, it, expect } from 'vitest'
import { PROVIDERS } from '@atizar/providers'
import { qualifierAgent, replyAgent as leadReply } from './lead-inbox/descriptor'
import { LEAD_INBOX_TOOLS } from './lead-inbox/tools'
import { LEAD_INBOX_CARDS } from './lead-inbox/cards'
import { EMAIL_INBOX_TOOLS } from './email-inbox/tools'
import { EMAIL_INBOX_CARDS } from './email-inbox/cards'
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

describe('lead-inbox tool/card consts', () => {
  it('tool consts equal the wire tool names', () => {
    expect(LEAD_INBOX_TOOLS.renderLead).toBe('renderLead')
    expect(LEAD_INBOX_TOOLS.saveDraft).toBe('saveDraft')
    expect(LEAD_INBOX_TOOLS.renderVerdict).toBe('renderVerdict')
  })
  it('card consts equal the wire card names', () => {
    expect(LEAD_INBOX_CARDS.LeadCard).toBe('LeadCard')
    expect(LEAD_INBOX_CARDS.VerdictCard).toBe('VerdictCard')
    expect(LEAD_INBOX_CARDS.ApprovalDialog).toBe('ApprovalDialog')
  })
  it('descriptor references the consts (renders map keyed by the tool const)', () => {
    expect(leadReply.renders[LEAD_INBOX_TOOLS.renderLead]).toBe(LEAD_INBOX_CARDS.LeadCard)
    expect(leadReply.renders[LEAD_INBOX_TOOLS.saveDraft]).toBe(LEAD_INBOX_CARDS.ApprovalDialog)
  })
})

describe('email-inbox tool/card consts', () => {
  it('tool consts equal the wire tool names', () => {
    expect(EMAIL_INBOX_TOOLS.route_emails).toBe('route_emails')
    expect(EMAIL_INBOX_TOOLS.renderSort).toBe('renderSort')
    expect(EMAIL_INBOX_TOOLS.renderLead).toBe('renderLead')
    expect(EMAIL_INBOX_TOOLS.saveDraft).toBe('saveDraft')
    expect(EMAIL_INBOX_TOOLS.applyActions).toBe('applyActions')
  })
  it('card consts equal the wire card names', () => {
    expect(EMAIL_INBOX_CARDS.SortSummaryCard).toBe('SortSummaryCard')
    expect(EMAIL_INBOX_CARDS.LeadCard).toBe('LeadCard')
    expect(EMAIL_INBOX_CARDS.ApprovalDialog).toBe('ApprovalDialog')
    expect(EMAIL_INBOX_CARDS.EmailBatchCard).toBe('EmailBatchCard')
  })
  it('descriptor references the consts', () => {
    expect(sorterAgent.renders[EMAIL_INBOX_TOOLS.renderSort]).toBe(EMAIL_INBOX_CARDS.SortSummaryCard)
    expect(readerAgent.renders[EMAIL_INBOX_TOOLS.applyActions]).toBe(EMAIL_INBOX_CARDS.EmailBatchCard)
  })
})
