import { describe, it, expect } from 'vitest'
import { aggregateAgent, aggregateLabel } from './aggregate'
import type { Status } from './status'
import type { Outcome } from '@atizar/core'

// Aggregation input is now {status, outcome} entries (the card needs the terminal outcome to
// show "Stopped"/"Rejected" instead of a bare "Done"). Helpers keep the tests terse.
type Entry = { status: Status; outcome: Outcome }
const live = (status: Status): Entry => ({ status, outcome: 'running' })
const term = (outcome: Outcome): Entry => ({ status: 'done', outcome })

describe('aggregateAgent', () => {
  it('is idle with no instances', () => {
    expect(aggregateAgent([])).toEqual({
      activeCount: 0,
      awaitingCount: 0,
      status: 'idle',
      outcome: null,
    })
  })
  it('counts active (running/awaiting) and awaiting separately', () => {
    const s: Entry[] = [live('running'), live('awaiting_approval'), term('done')]
    expect(aggregateAgent(s)).toEqual({
      activeCount: 2,
      awaitingCount: 1,
      status: 'awaiting_approval',
      outcome: null,
    })
  })
  it('priority: awaiting_approval > error > running > done > idle', () => {
    expect(aggregateAgent([live('running'), live('error')]).status).toBe('error')
    expect(aggregateAgent([live('error'), live('awaiting_approval')]).status).toBe(
      'awaiting_approval'
    )
    expect(aggregateAgent([term('done')]).status).toBe('done')
  })
  it('a single finished scan aggregates to Done with no active label', () => {
    const a = aggregateAgent([term('done')])
    expect(a.status).toBe('done')
    expect(a.activeCount).toBe(0)
    expect(aggregateLabel(a)).toBe('')
  })
})

// The terminal OUTCOME the card displays when nothing is live (status === 'done'). A distinct
// terminal (stopped/rejected) is the notable state and wins over a clean done; a live or idle
// set carries no terminal outcome (outcome === null → card shows the live status label).
describe('aggregateAgent terminal outcome (for the type card)', () => {
  it('an agent whose only instances are stopped → status done, outcome stopped', () => {
    const a = aggregateAgent([term('stopped')])
    expect(a.status).toBe('done')
    expect(a.outcome).toBe('stopped')
  })
  it('a mix of done + stopped prefers the distinct terminal (stopped)', () => {
    expect(aggregateAgent([term('done'), term('stopped')]).outcome).toBe('stopped')
    expect(aggregateAgent([term('stopped'), term('done')]).outcome).toBe('stopped')
  })
  it('a mix of done + rejected prefers the distinct terminal (rejected)', () => {
    expect(aggregateAgent([term('done'), term('rejected')]).outcome).toBe('rejected')
  })
  it('all clean done → outcome done', () => {
    expect(aggregateAgent([term('done'), term('done')]).outcome).toBe('done')
  })
  it('a live (awaiting/running) set carries no terminal outcome', () => {
    expect(aggregateAgent([live('awaiting_approval'), term('stopped')]).outcome).toBe(null)
    expect(aggregateAgent([live('running'), term('stopped')]).outcome).toBe(null)
  })
  it('an error-only set carries no terminal outcome (error shows via status)', () => {
    expect(aggregateAgent([live('error')]).outcome).toBe(null)
  })
})

// START visibility on the type card is gated by `aggregateLabel(agg) === ''` (see AgentGrid):
// an empty headline means no BUSY instance is holding a slot, so START shows. Unit 4.2: an
// error-only agent reads 0 active → empty label → START shows, with the error badge alongside.
describe('START gating via aggregateLabel (Unit 4.2)', () => {
  it('an agent whose only instance is error shows START (empty label) AND the error badge', () => {
    const a = aggregateAgent([live('error')])
    // Empty headline ⇒ AgentGrid exposes START (the gate is aggregateLabel === '').
    expect(aggregateLabel(a)).toBe('')
    // The error still surfaces as a badge alongside START via the aggregate status.
    expect(a.status).toBe('error')
  })
  it('a running instance has a non-empty label (START hidden)', () => {
    expect(aggregateLabel(aggregateAgent([live('running')]))).toBe('1 active')
  })
  it('an awaiting_approval instance has a non-empty label (START hidden)', () => {
    expect(aggregateLabel(aggregateAgent([live('awaiting_approval')]))).toBe(
      '1 active · 1 awaiting approval'
    )
  })
  it('an error alongside a running instance keeps a non-empty label (the run holds the slot)', () => {
    expect(aggregateLabel(aggregateAgent([live('error'), live('running')]))).toBe('1 active')
  })
  it('an idle / done-only agent has an empty label (START shows)', () => {
    expect(aggregateLabel(aggregateAgent([]))).toBe('')
    expect(aggregateLabel(aggregateAgent([term('done')]))).toBe('')
  })
  it('an error-only agent reads 0 active (error ∉ isBusy → START stays exposed)', () => {
    const a = aggregateAgent([{ status: 'error', outcome: 'error' }])
    expect(a.activeCount).toBe(0)
    expect(aggregateLabel(a)).toBe('') // empty headline → never hides START
  })
})
