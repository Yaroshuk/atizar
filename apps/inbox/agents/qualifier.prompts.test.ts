import { describe, it, expect } from 'vitest'
import { encodeHandoff } from '@atizar/core'
import { createQualifierPrompts } from './qualifier.prompts.js'

const input = (messages: unknown[]) => ({ messages }) as never

describe('qualifier prompt strategy', () => {
  const prompts = createQualifierPrompts('Qualify leads.', 'lead-inbox')

  it('first prompt reads the email and calls renderVerdict', () => {
    const p = prompts.buildFirst(input([]))
    expect(p).toContain('get_latest_email')
    expect(p).toContain('renderVerdict')
  })

  it('embeds origin in the renderVerdict instruction', () => {
    const p = prompts.buildFirst(input([]))
    expect(p).toContain('origin: "lead-inbox"')
  })

  it('has no resume strategy (no approvals)', () => {
    expect(prompts.buildResume).toBeUndefined()
  })

  it('uses the handed lead path when a handoff seed is present', () => {
    const seed = encodeHandoff({
      threadId: 'thread-1',
      from: 'alice@example.com',
      subject: 'Demo request',
      summary: 'Wants a product demo.',
      category: 'sales',
      priority: 'hot',
    })
    const p = prompts.buildFirst(input([seed]))
    expect(p).toContain('routed to you from another workflow')
    expect(p).toContain('alice@example.com')
    expect(p).toContain('Demo request')
    expect(p).toContain('origin: "lead-inbox"')
    expect(p).not.toContain('get_latest_email')
  })
})
