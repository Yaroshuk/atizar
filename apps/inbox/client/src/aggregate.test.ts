import { describe, it, expect } from 'vitest'
import { aggregateAgent } from './aggregate'
import type { Status } from './status'

describe('aggregateAgent', () => {
  it('is idle with no instances', () => {
    expect(aggregateAgent([])).toEqual({ activeCount: 0, awaitingCount: 0, status: 'idle' })
  })
  it('counts active (running/awaiting/error) and awaiting separately', () => {
    const s: Status[] = ['running', 'awaiting_approval', 'done']
    expect(aggregateAgent(s)).toEqual({
      activeCount: 2,
      awaitingCount: 1,
      status: 'awaiting_approval',
    })
  })
  it('priority: awaiting_approval > error > running > done > idle', () => {
    expect(aggregateAgent(['running', 'error']).status).toBe('error')
    expect(aggregateAgent(['error', 'awaiting_approval']).status).toBe('awaiting_approval')
    expect(aggregateAgent(['done']).status).toBe('done')
  })
})
