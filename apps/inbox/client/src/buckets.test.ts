import { describe, it, expect } from 'vitest'
import { groupByStatus, type TriageTicket } from './buckets'

const t = (over: Partial<TriageTicket>): TriageTicket => ({
  repo: 'm/r',
  number: 1,
  title: 't',
  status: 'Todo',
  priority: 'Low',
  body: '',
  url: 'u',
  lastComment: null,
  needsReply: false,
  recommendation: 'feature',
  ...over,
})

describe('groupByStatus', () => {
  it('groups tickets under their status in board order', () => {
    const groups = groupByStatus([
      t({ number: 1, status: 'Todo' }),
      t({ number: 2, status: 'In progress' }),
      t({ number: 3, status: 'Todo' }),
    ])
    expect(groups.map((g) => g.status)).toEqual(['Todo', 'In progress'])
    expect(groups.find((g) => g.status === 'Todo')!.tickets.map((x) => x.number)).toEqual([1, 3])
  })

  it('omits empty status groups', () => {
    const groups = groupByStatus([t({ status: 'Backlog' })])
    expect(groups.map((g) => g.status)).toEqual(['Backlog'])
  })

  it('puts unknown statuses last', () => {
    const groups = groupByStatus([t({ status: 'Weird' }), t({ status: 'Todo' })])
    expect(groups.map((g) => g.status)).toEqual(['Todo', 'Weird'])
  })
})
