import { describe, it, expect } from 'vitest'
import { emailInboxServer } from './server.js'
import { sorterAgent, replyAgent, readerAgent, spamAgent, importantAgent } from './descriptor.js'

// §24 safety locks (SF1/SF2): the per-agent tool allow-lists are the hard boundary that keeps a
// reader agent from writing and keeps mail from ever being sent. These are regression LOCKS — they
// must stay green through every change.
const bindings = emailInboxServer()
const toolsOf = (agentId: string): string[] =>
  bindings.find((b) => b.agentId === agentId)?.allowedTools ?? []

describe('email-inbox tool allow-lists (§24 safety locks)', () => {
  it('SF1: each agent is restricted to exactly its role tools', () => {
    expect(toolsOf(sorterAgent.id)).toEqual([
      'mcp__gmail__list_unread',
      'mcp__inbox__renderSort',
      'mcp__inbox__route_emails',
    ])
    expect(toolsOf(replyAgent.id)).toEqual([
      'mcp__gmail__get_email',
      'mcp__inbox__renderLead',
      'mcp__inbox__saveDraft',
    ])
    for (const a of [readerAgent, spamAgent, importantAgent]) {
      expect(toolsOf(a.id)).toEqual(['mcp__inbox__applyActions'])
    }
  })

  it('SF1: the inbox-read tool is disjoint from the draft-write tool (sorter reads, reply drafts)', () => {
    expect(toolsOf(sorterAgent.id)).not.toContain('mcp__inbox__saveDraft') // sorter cannot draft
    expect(toolsOf(replyAgent.id)).not.toContain('mcp__gmail__list_unread') // reply cannot scan inbox
  })

  it('SF2: no agent can SEND mail — the only Gmail tools exposed are reads, writes go through gated effects', () => {
    const all = bindings.flatMap((b) => b.allowedTools ?? [])
    for (const t of all) expect(t).not.toMatch(/send/i)
    // The only raw Gmail tools any agent may call are the two reads. createDraft / applyEmailActions
    // are server-executed effects behind an approval gate, never model-callable tools.
    const gmailTools = [...new Set(all.filter((t) => t.startsWith('mcp__gmail__')))].sort()
    expect(gmailTools).toEqual(['mcp__gmail__get_email', 'mcp__gmail__list_unread'])
  })
})
