import { describe, it, expect } from 'vitest'
import { lookups } from './lookups'
import type { WorkflowsConfig } from './workflowsContext'
import type { WorkItem } from './serverTypes'

const cfg = {
  workflows: [
    {
      id: 'lead-inbox',
      label: 'Lead inbox',
      agents: [
        { agent: { id: 'qualifier', name: 'LEAD QUALIFIER' }, role: 'input' },
        { agent: { id: 'reply', name: 'REPLY AGENT' }, role: 'worker' },
      ],
    },
  ],
  meta: { qualifier: { iconName: 'inbox' }, reply: { iconName: 'reply' } },
  renders: [],
  hitl: [],
} as unknown as WorkflowsConfig

const wi = (over: Partial<WorkItem>): WorkItem =>
  ({
    id: 'w1',
    workflowId: 'lead-inbox',
    agentId: 'lead-inbox__reply',
    payload: {},
    ...over,
  }) as WorkItem

describe('lookups', () => {
  it('resolves role, name, icon, stripped agent id, and label', () => {
    const lk = lookups(cfg, 'lead-inbox')
    expect(lk.roleOf('qualifier')).toBe('input')
    expect(lk.nameOf('reply')).toBe('REPLY AGENT')
    expect(lk.nameOf('unknown')).toBe('unknown')
    expect(lk.metaIcon('reply')).toBe('reply')
    expect(lk.metaIcon('missing')).toBe('inbox')
    expect(lk.stripAgent(wi({}))).toBe('reply')
  })
  it('labels by issue number, else from/subject', () => {
    const lk = lookups(cfg, 'lead-inbox')
    expect(lk.labelOf(wi({ payload: { number: 5, title: 'Bug' } }))).toBe('#5 · Bug')
    expect(lk.labelOf(wi({ payload: { from: 'a@b.com' } }))).toBe('a@b.com')
    expect(lk.labelOf(wi({ payload: { subject: 'Hi' } }))).toBe('Hi')
  })
})
