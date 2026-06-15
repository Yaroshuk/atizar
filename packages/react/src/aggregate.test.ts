import { describe, it, expect } from 'vitest'
import { aggregateAgent, aggregateLabel } from './aggregate'
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
  it('a single finished scan aggregates to Done with no active label', () => {
    const a = aggregateAgent(['done'])
    expect(a.status).toBe('done')
    expect(a.activeCount).toBe(0)
    expect(aggregateLabel(a)).toBe('')
  })
})

// START visibility on the type card is gated by `aggregateLabel(agg) === ''` (see AgentGrid):
// an empty headline means no BUSY instance is holding a slot, so START shows. Unit 4.2: an
// error-only agent reads 0 active → empty label → START shows, with the error badge alongside.
describe('START gating via aggregateLabel (Unit 4.2)', () => {
  it('an agent whose only instance is error shows START (empty label) AND the error badge', () => {
    const a = aggregateAgent(['error'])
    // Empty headline ⇒ AgentGrid exposes START (the gate is aggregateLabel === '').
    expect(aggregateLabel(a)).toBe('')
    // The error still surfaces as a badge alongside START via the aggregate status.
    expect(a.status).toBe('error')
  })
  it('a running instance has a non-empty label (START hidden)', () => {
    expect(aggregateLabel(aggregateAgent(['running']))).toBe('1 active')
  })
  it('an awaiting_approval instance has a non-empty label (START hidden)', () => {
    expect(aggregateLabel(aggregateAgent(['awaiting_approval']))).toBe(
      '1 active · 1 awaiting approval'
    )
  })
  it('an error alongside a running instance keeps a non-empty label (the run holds the slot)', () => {
    expect(aggregateLabel(aggregateAgent(['error', 'running']))).toBe('1 active')
  })
  it('an idle / done-only agent has an empty label (START shows)', () => {
    expect(aggregateLabel(aggregateAgent([]))).toBe('')
    expect(aggregateLabel(aggregateAgent(['done']))).toBe('')
  })
})
