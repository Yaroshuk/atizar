import { describe, it, expect } from 'vitest'
import { mapStatus } from './status'

describe('mapStatus (server status union → display Status)', () => {
  it('maps queued and running to running', () => {
    expect(mapStatus('queued')).toBe('running')
    expect(mapStatus('running')).toBe('running')
  })
  it('maps awaiting_approval and awaiting_input to awaiting_approval', () => {
    expect(mapStatus('awaiting_approval')).toBe('awaiting_approval')
    expect(mapStatus('awaiting_input')).toBe('awaiting_approval')
  })
  it('maps result, finished and closed to done', () => {
    expect(mapStatus('result')).toBe('done')
    expect(mapStatus('finished')).toBe('done')
    expect(mapStatus('closed')).toBe('done')
  })
  it('maps error to error', () => {
    expect(mapStatus('error')).toBe('error')
  })
})
