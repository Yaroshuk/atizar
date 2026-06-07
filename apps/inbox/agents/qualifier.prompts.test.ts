import { describe, it, expect } from 'vitest'
import { createQualifierPrompts } from './qualifier.prompts.js'

const input = (messages: unknown[]) => ({ messages }) as never

describe('qualifier prompt strategy', () => {
  const prompts = createQualifierPrompts('Qualify leads.')

  it('first prompt reads the email and calls renderVerdict', () => {
    const p = prompts.buildFirst(input([]))
    expect(p).toContain('get_latest_email')
    expect(p).toContain('renderVerdict')
  })

  it('has no resume strategy (no approvals)', () => {
    expect(prompts.buildResume).toBeUndefined()
  })
})
