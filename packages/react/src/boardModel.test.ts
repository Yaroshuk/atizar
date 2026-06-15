import { describe, it, expect } from 'vitest'
import type { WorkItem } from './serverTypes'
import { toPInstances, queuedByAgent, statusesOf } from './boardModel'

const wi = (over: Partial<WorkItem> & Pick<WorkItem, 'id' | 'agentId' | 'status'>): WorkItem => ({
  workflowId: 'lead-inbox',
  parentId: null,
  origin: 'human',
  source: null,
  payload: {},
  resolution: null,
  card: null,
  error: null,
  ...over,
})

const items: WorkItem[] = [
  wi({ id: 'Q', agentId: 'lead-inbox__qualifier', status: 'running' }),
  wi({ id: 'A', agentId: 'lead-inbox__reply', status: 'awaiting_approval', parentId: 'Q' }),
  wi({ id: 'B', agentId: 'lead-inbox__reply', status: 'queued', parentId: 'Q' }),
  // a different workflow's item — must be ignored by the lead-inbox queries
  wi({ id: 'X', agentId: 'github-triage__triage', status: 'running', workflowId: 'github-triage' }),
]

const roleOf = (a: string) => (a === 'qualifier' ? 'input' : 'worker') as 'input' | 'worker'
const metaIcon = () => 'inbox'
const nameOf = (a: string) => a
const labelOf = (w: WorkItem) => String(w.payload.subject ?? '')

describe('toPInstances', () => {
  it('maps visible board items of a workflow to PInstances (queued excluded)', () => {
    const out = toPInstances(items, 'lead-inbox', roleOf, metaIcon, nameOf, labelOf)
    expect(out.map((p) => p.localId).sort()).toEqual(['A', 'Q'])
    const q = out.find((p) => p.localId === 'Q')!
    expect(q).toMatchObject({ agentId: 'qualifier', status: 'running', isInput: true })
    expect(q.parentLocalId).toBeUndefined()
    const a = out.find((p) => p.localId === 'A')!
    expect(a).toMatchObject({
      agentId: 'reply',
      status: 'awaiting_approval',
      isInput: false,
      parentLocalId: 'Q',
    })
  })
})

describe('queuedByAgent', () => {
  it('counts queued items per agent within the workflow', () => {
    expect(queuedByAgent(items, 'lead-inbox')).toEqual({ reply: 1 })
  })
})

describe('statusesOf', () => {
  it('returns display statuses of a given agent (queued excluded)', () => {
    expect(statusesOf(items, 'lead-inbox', 'reply')).toEqual(['awaiting_approval'])
    expect(statusesOf(items, 'lead-inbox', 'qualifier')).toEqual(['running'])
  })
})

describe('toPInstances superseded roots (WS1)', () => {
  const withSuperseded: WorkItem[] = [
    wi({ id: 'Q1', agentId: 'lead-inbox__qualifier', status: 'closed', resolution: 'superseded' }),
    wi({ id: 'Q2', agentId: 'lead-inbox__qualifier', status: 'running' }),
  ]
  it('hides a closed+superseded input root, keeps the current running one', () => {
    const out = toPInstances(withSuperseded, 'lead-inbox', roleOf, metaIcon, nameOf, labelOf)
    expect(out.map((p) => p.localId)).toEqual(['Q2'])
  })
  it('still keeps a plain finished input root (not superseded)', () => {
    const finishedRoot: WorkItem[] = [
      wi({ id: 'Q3', agentId: 'lead-inbox__qualifier', status: 'finished' }),
    ]
    const out = toPInstances(finishedRoot, 'lead-inbox', roleOf, metaIcon, nameOf, labelOf)
    expect(out.map((p) => p.localId)).toEqual(['Q3'])
  })
})
