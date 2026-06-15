import { describe, it, expect } from 'vitest'
import { PROVIDERS } from '@atizar/providers/ids'
import { EMAIL_INBOX_TOOLS } from './email-inbox/tools'
import { EMAIL_INBOX_CARDS } from './email-inbox/cards'
import {
  sorterAgent,
  replyAgent as emailReply,
  readerAgent,
  spamAgent,
  importantAgent,
} from './email-inbox/descriptor'

const ALL = [sorterAgent, emailReply, readerAgent, spamAgent, importantAgent]

describe('descriptors parse via defineAgent after the const refactor', () => {
  it('every agent resolves provider to the claude-cli wire string', () => {
    for (const a of ALL) {
      expect(a.provider).toBe(PROVIDERS.claudeCli)
      expect(a.provider).toBe('claude-cli')
    }
  })

  it('email-inbox reply declares saveDraft as tool + approval + effect and renders its cards', () => {
    expect(emailReply.tools).toContain('saveDraft')
    expect(emailReply.approvals).toContain('saveDraft')
    expect(emailReply.effects).toContain('saveDraft')
    expect(emailReply.renders.saveDraft).toBe('ApprovalDialog')
    expect(emailReply.renders.renderLead).toBe('LeadCard')
  })

  it('email-inbox sorter still declares route_emails as tool + dispatch', () => {
    expect(sorterAgent.tools).toContain('route_emails')
    expect(sorterAgent.dispatches).toContain('route_emails')
    expect(sorterAgent.renders.renderSort).toBe('SortSummaryCard')
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
    expect(sorterAgent.renders[EMAIL_INBOX_TOOLS.renderSort]).toBe(
      EMAIL_INBOX_CARDS.SortSummaryCard
    )
    expect(readerAgent.renders[EMAIL_INBOX_TOOLS.applyActions]).toBe(
      EMAIL_INBOX_CARDS.EmailBatchCard
    )
    expect(emailReply.renders[EMAIL_INBOX_TOOLS.renderLead]).toBe(EMAIL_INBOX_CARDS.LeadCard)
    expect(emailReply.renders[EMAIL_INBOX_TOOLS.saveDraft]).toBe(EMAIL_INBOX_CARDS.ApprovalDialog)
  })
})
