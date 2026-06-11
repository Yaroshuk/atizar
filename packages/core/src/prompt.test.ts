import { describe, it, expect } from 'vitest'
import { composeInstructions } from './prompt.js'

describe('composeInstructions', () => {
  it('prepends the workflow prompt above the agent instructions', () => {
    expect(composeInstructions('Be terse.', 'Draft a reply.')).toBe('Be terse.\n\nDraft a reply.')
  })
  it('returns the agent instructions unchanged when there is no workflow prompt', () => {
    expect(composeInstructions(undefined, 'Draft a reply.')).toBe('Draft a reply.')
    expect(composeInstructions('', 'Draft a reply.')).toBe('Draft a reply.')
    expect(composeInstructions('   ', 'Draft a reply.')).toBe('Draft a reply.')
  })
})
