import { describe, it, expect } from 'vitest'
import { buildPipeline, type PInstance } from './pipelineModel'

const i = (over: Partial<PInstance>): PInstance => ({
  localId: 'x',
  runtimeKey: 'wf__a',
  agentId: 'a',
  name: 'A',
  iconName: 'inbox',
  label: '',
  status: 'running',
  parentLocalId: undefined,
  isInput: false,
  ...over,
})

describe('buildPipeline', () => {
  it('keeps a RUNNING input agent as a lone header', () => {
    const blocks = buildPipeline(
      [i({ localId: 'in', agentId: 'triage', isInput: true, status: 'running', label: '' })],
      {}
    )
    expect(blocks).toHaveLength(1)
    expect(blocks[0].parent.localId).toBe('in')
    expect(blocks[0].groups).toEqual([])
  })

  it('drops a DONE input agent with no active child (it leaves the live column, Unit 4.1)', () => {
    const blocks = buildPipeline(
      [i({ localId: 'in', agentId: 'triage', isInput: true, status: 'done', label: '' })],
      {}
    )
    expect(blocks).toHaveLength(0)
  })

  it('keeps a DONE input agent that still has an active child', () => {
    const blocks = buildPipeline(
      [
        i({ localId: 'in', agentId: 'triage', isInput: true, status: 'done' }),
        i({ localId: 'c1', agentId: 'reply', parentLocalId: 'in', status: 'running' }),
      ],
      {}
    )
    expect(blocks.map((b) => b.parent.localId)).toContain('in')
  })

  it('one child instance renders as a single-instance group', () => {
    const blocks = buildPipeline(
      [
        i({ localId: 'in', agentId: 'triage', isInput: true, status: 'done' }),
        i({
          localId: 'c1',
          agentId: 'feature',
          name: 'FEATURE',
          parentLocalId: 'in',
          label: '#150 CSV',
          status: 'running',
        }),
      ],
      {}
    )
    expect(blocks[0].groups).toHaveLength(1)
    expect(blocks[0].groups[0].instances.map((x) => x.localId)).toEqual(['c1'])
  })

  it('two instances of the same agent group together under that agent', () => {
    const blocks = buildPipeline(
      [
        i({ localId: 'in', agentId: 'triage', isInput: true, status: 'done' }),
        i({
          localId: 'r1',
          runtimeKey: 'wf__reply',
          agentId: 'reply',
          name: 'REPLY',
          parentLocalId: 'in',
          label: '#142',
          status: 'awaiting_approval',
        }),
        i({
          localId: 'r2',
          runtimeKey: 'wf__reply',
          agentId: 'reply',
          name: 'REPLY',
          parentLocalId: 'in',
          label: '#143',
          status: 'running',
        }),
      ],
      {}
    )
    const g = blocks[0].groups.find((x) => x.agentId === 'reply')!
    expect(g.instances).toHaveLength(2)
  })

  it('attaches the queued count to its agent group', () => {
    const blocks = buildPipeline(
      [
        i({ localId: 'in', agentId: 'triage', isInput: true, status: 'done' }),
        i({
          localId: 'r1',
          runtimeKey: 'wf__reply',
          agentId: 'reply',
          parentLocalId: 'in',
          status: 'running',
        }),
      ],
      { reply: 2 }
    )
    const g = blocks[0].groups.find((x) => x.agentId === 'reply')!
    expect(g.queued).toBe(2)
  })

  it('drops a done worker with no active child (and its now-terminal input root too)', () => {
    const blocks = buildPipeline(
      [
        i({ localId: 'in', agentId: 'triage', isInput: true, status: 'done' }),
        i({ localId: 'c1', agentId: 'feature', parentLocalId: 'in', status: 'done' }),
      ],
      {}
    )
    // Both the worker and the now-terminal input root with no live work leave the live column.
    expect(blocks).toHaveLength(0)
  })

  it('keeps a running input root and drops its done leaf worker', () => {
    const blocks = buildPipeline(
      [
        i({ localId: 'in', agentId: 'triage', isInput: true, status: 'running' }),
        i({ localId: 'c1', agentId: 'feature', parentLocalId: 'in', status: 'done' }),
      ],
      {}
    )
    expect(blocks).toHaveLength(1)
    expect(blocks[0].parent.localId).toBe('in')
    expect(blocks[0].groups).toEqual([])
  })

  it('repeats a parent as its own block (depth-2) when an instance dispatches a child', () => {
    const blocks = buildPipeline(
      [
        i({ localId: 'in', agentId: 'triage', isInput: true, status: 'done' }),
        i({
          localId: 'r1',
          runtimeKey: 'wf__reply',
          agentId: 'reply',
          parentLocalId: 'in',
          status: 'done',
        }),
        i({ localId: 'b1', agentId: 'bugfix', parentLocalId: 'r1', status: 'running' }),
      ],
      {}
    )
    // r1 is done but kept (ancestor of active b1) and appears as a parent block.
    const parentIds = blocks.map((bl) => bl.parent.localId)
    expect(parentIds).toContain('r1')
    const r1Block = blocks.find((bl) => bl.parent.localId === 'r1')!
    expect(r1Block.groups[0].instances[0].localId).toBe('b1')
  })

  it('a kept input root WITH a live child still shows Working', () => {
    const blocks = buildPipeline(
      [
        i({ localId: 'in', agentId: 'sorter', isInput: true, status: 'done' }),
        i({ localId: 'c1', agentId: 'reply', parentLocalId: 'in', status: 'running' }),
      ],
      {}
    )
    expect(blocks[0].parent.status).toBe('running')
  })

  it('a finished parent with an awaiting-approval child still renders as Working (live-descendant)', () => {
    // Approach B: the parent's DB run finished on its own (status 'done' here), but its child is
    // still awaiting approval, so the view() live-descendant override shows the parent Working.
    const blocks = buildPipeline(
      [
        i({ localId: 'r', agentId: 'sorter', isInput: true, status: 'done' }),
        i({ localId: 'c', agentId: 'reply', parentLocalId: 'r', status: 'awaiting_approval' }),
      ],
      {}
    )
    expect(blocks[0].parent.status).toBe('running')
  })

  it('a kept-but-done intermediate parent (live grandchild) shows Working', () => {
    const blocks = buildPipeline(
      [
        i({ localId: 'in', agentId: 'sorter', isInput: true, status: 'done' }),
        i({ localId: 'r1', agentId: 'reply', parentLocalId: 'in', status: 'done' }),
        i({ localId: 'b1', agentId: 'bugfix', parentLocalId: 'r1', status: 'running' }),
      ],
      {}
    )
    // 'in' has a live descendant (b1 under r1) so it shows Working; r1 also shows Working.
    expect(blocks.find((bl) => bl.parent.localId === 'in')!.parent.status).toBe('running')
    expect(blocks.find((bl) => bl.parent.localId === 'r1')!.parent.status).toBe('running')
  })
})
