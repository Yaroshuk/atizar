import { describe, it, expect, beforeEach } from 'vitest'
import { setSessionEnabled, sessionHeaders } from './session'

describe('session (tenant header)', () => {
  beforeEach(() => {
    localStorage.clear()
    setSessionEnabled(false)
  })

  it('sends no header when disabled (non-demo → server uses global)', () => {
    expect(sessionHeaders()).toEqual({})
  })

  it('sends a stable X-Atizar-Session when enabled (demo)', () => {
    setSessionEnabled(true)
    const h = sessionHeaders()
    expect(h['X-Atizar-Session']).toMatch(/[0-9a-f-]{8,}/)
    expect(sessionHeaders()).toEqual(h) // stable across calls
  })
})
