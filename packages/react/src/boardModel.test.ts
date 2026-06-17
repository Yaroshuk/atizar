import { describe, it, expect } from 'vitest'
import type { WorkItem } from './serverTypes'
import { toPInstances, queuedByAgent, entriesOf } from './boardModel'

const wi = (over: Partial<WorkItem> & Pick<WorkItem, 'id' | 'agentId' | 'phase'>): WorkItem => ({
  workflowId: 'lead-inbox',
  parentId: null,
  origin: 'human',
  source: null,
  key: '',
  payload: {},
  outcome: 'running',
  card: null,
  error: null,
  ...over,
})

const items: WorkItem[] = [
  wi({ id: 'Q', agentId: 'lead-inbox__qualifier', phase: 'active', outcome: 'running' }),
  wi({
    id: 'A',
    agentId: 'lead-inbox__reply',
    phase: 'awaiting_human',
    outcome: 'running',
    parentId: 'Q',
  }),
  wi({ id: 'B', agentId: 'lead-inbox__reply', phase: 'queued', outcome: 'running', parentId: 'Q' }),
  // a different workflow's item — must be ignored by the lead-inbox queries
  wi({
    id: 'X',
    agentId: 'github-triage__triage',
    phase: 'active',
    outcome: 'running',
    workflowId: 'github-triage',
  }),
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

describe('entriesOf', () => {
  it('returns {status, outcome} entries of a given agent (queued excluded)', () => {
    expect(entriesOf(items, 'lead-inbox', 'reply')).toEqual([
      { status: 'awaiting_approval', outcome: 'running' },
    ])
    expect(entriesOf(items, 'lead-inbox', 'qualifier')).toEqual([
      { status: 'running', outcome: 'running' },
    ])
  })

  it('excludes retired items so a Reset/superseded agent reads idle, not done', () => {
    const afterReset: WorkItem[] = [
      wi({ id: 'S1', agentId: 'lead-inbox__qualifier', phase: 'terminal', outcome: 'reset' }),
      wi({
        id: 'S2',
        agentId: 'lead-inbox__qualifier',
        phase: 'terminal',
        outcome: 'superseded',
      }),
    ]
    // all runs retired → no entries contribute → the type card returns to idle (empty list)
    expect(entriesOf(afterReset, 'lead-inbox', 'qualifier')).toEqual([])
    // a still-relevant run is unaffected: a done (not retired) run keeps reading 'done'
    const mixed: WorkItem[] = [
      ...afterReset,
      wi({ id: 'F', agentId: 'lead-inbox__qualifier', phase: 'terminal', outcome: 'done' }),
    ]
    expect(entriesOf(mixed, 'lead-inbox', 'qualifier')).toEqual([
      { status: 'done', outcome: 'done' },
    ])
  })

  it('carries the distinct terminal outcome (stopped) through for the type card', () => {
    const stopped: WorkItem[] = [
      wi({ id: 'T', agentId: 'lead-inbox__qualifier', phase: 'terminal', outcome: 'stopped' }),
    ]
    expect(entriesOf(stopped, 'lead-inbox', 'qualifier')).toEqual([
      { status: 'done', outcome: 'stopped' },
    ])
  })
})

describe('toPInstances key propagation', () => {
  it('carries the work item key onto the PInstance', () => {
    const keyed = [
      wi({ id: 'r1', agentId: 'lead-inbox__reply', phase: 'active', key: 'alice@x.com' }),
    ]
    const [p] = toPInstances(keyed, 'lead-inbox', roleOf, metaIcon, nameOf, labelOf)
    expect(p.key).toBe('alice@x.com')
  })
})

describe('toPInstances superseded roots (WS1)', () => {
  const withSuperseded: WorkItem[] = [
    wi({ id: 'Q1', agentId: 'lead-inbox__qualifier', phase: 'terminal', outcome: 'superseded' }),
    wi({ id: 'Q2', agentId: 'lead-inbox__qualifier', phase: 'active', outcome: 'running' }),
  ]
  it('hides a retired+superseded input root, keeps the current running one', () => {
    const out = toPInstances(withSuperseded, 'lead-inbox', roleOf, metaIcon, nameOf, labelOf)
    expect(out.map((p) => p.localId)).toEqual(['Q2'])
  })
  it('hides a done input root with NO active child (it leaves the live column)', () => {
    const finishedRoot: WorkItem[] = [
      wi({ id: 'Q3', agentId: 'lead-inbox__qualifier', phase: 'terminal', outcome: 'done' }),
    ]
    const out = toPInstances(finishedRoot, 'lead-inbox', roleOf, metaIcon, nameOf, labelOf)
    expect(out.map((p) => p.localId)).toEqual([])
  })

  // Regression: a retired input root (Reset OR superseded) carries its summary card forever, so
  // the old card-keeps-it-visible rule kept EVERY reset run on the board — they piled up as phantom
  // "Done" instances in the picker/pipeline. A retired item has LEFT the board and must never be a
  // live instance, card or not. With N resets the picker must show ZERO, not N. (The server drops
  // these rows entirely now — but core lifecycle().isVisible enforces it client-side too.)
  it('hides ALL retired input roots even when they carry a card (reset must not pile up)', () => {
    const card = { tool: 'renderSort', props: {} }
    const afterResets: WorkItem[] = [
      wi({
        id: 'R1',
        agentId: 'lead-inbox__qualifier',
        phase: 'terminal',
        outcome: 'reset',
        card,
      }),
      wi({
        id: 'R2',
        agentId: 'lead-inbox__qualifier',
        phase: 'terminal',
        outcome: 'reset',
        card,
      }),
      wi({
        id: 'R3',
        agentId: 'lead-inbox__qualifier',
        phase: 'terminal',
        outcome: 'superseded',
        card,
      }),
    ]
    const out = toPInstances(afterResets, 'lead-inbox', roleOf, metaIcon, nameOf, labelOf)
    expect(out.map((p) => p.localId)).toEqual([])
  })

  it('keeps a done input root that still has an active child', () => {
    const withChild: WorkItem[] = [
      wi({ id: 'Q4', agentId: 'lead-inbox__qualifier', phase: 'terminal', outcome: 'done' }),
      wi({
        id: 'C4',
        agentId: 'lead-inbox__reply',
        phase: 'active',
        outcome: 'running',
        parentId: 'Q4',
      }),
    ]
    const out = toPInstances(withChild, 'lead-inbox', roleOf, metaIcon, nameOf, labelOf)
    // toPInstances itself is per-row; buildPipeline does the ancestor-promotion walk. Here we
    // assert the row is emitted (visible) because it carries a card/marker OR a live descendant —
    // a bare done root with no card still needs the active child to stay (hasLiveDescendant).
    expect(out.map((p) => p.localId).sort()).toEqual(['C4', 'Q4'])
  })
})
