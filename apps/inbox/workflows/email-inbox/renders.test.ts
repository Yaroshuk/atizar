// @vitest-environment node
//
// Contract guard: the renderSort render spec must accept summary-only and must NOT
// surface a `counts` key (model contributes prose only; numbers are workflow-projected).
import { describe, it, expect } from 'vitest'
import { emailInboxRenders } from './client.js'
import { EMAIL_INBOX_TOOLS as t } from './tools.js'

describe('renderSort render spec — counts stripped from contract', () => {
  const spec = emailInboxRenders.find((r) => r.toolName === t.renderSort)!

  it('spec exists', () => {
    expect(spec).toBeDefined()
  })

  it('accepts summary-only input', () => {
    expect(spec.parameters.safeParse({ summary: 'ok' }).success).toBe(true)
  })

  it('does NOT surface a counts key (model no longer sends numbers)', () => {
    const result = spec.parameters.safeParse({ summary: 'ok', counts: { reply: 1 } })
    expect('counts' in (result as any).data).toBe(false)
  })
})
