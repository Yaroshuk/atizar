import { describe, it, expect } from 'vitest'
import { buildPipeline, type PInstance } from './pipelineModel'

const i = (over: Partial<PInstance>): PInstance => ({
  localId: 'x',
  runtimeKey: 'wf__a',
  agentId: 'a',
  key: '',
  name: 'A',
  iconName: 'inbox',
  label: '',
  status: 'running',
  outcome: 'running',
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
    expect(blocks[0].groups[0].instances.map((x) => x.head.localId)).toEqual(['c1'])
  })

  it('two instances of the same agent group together under that agent', () => {
    const blocks = buildPipeline(
      [
        i({ localId: 'in', agentId: 'triage', isInput: true, status: 'done' }),
        i({
          localId: 'r1',
          runtimeKey: 'wf__reply',
          agentId: 'reply',
          key: '142',
          name: 'REPLY',
          parentLocalId: 'in',
          label: '#142',
          status: 'awaiting_approval',
        }),
        i({
          localId: 'r2',
          runtimeKey: 'wf__reply',
          agentId: 'reply',
          key: '143',
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
    expect(r1Block.groups[0].instances[0].head.localId).toBe('b1')
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

  it('collapses two Runs sharing (agentId, key) into ONE instance node', () => {
    const sorter = i({
      localId: 's',
      agentId: 'sorter',
      key: 'sorter',
      isInput: true,
      status: 'running',
    })
    const r1 = i({
      localId: 'r1',
      agentId: 'reply',
      key: 'alice',
      parentLocalId: 's',
      status: 'running',
    })
    const r2 = i({
      localId: 'r2',
      agentId: 'reply',
      key: 'alice',
      parentLocalId: 's',
      status: 'running',
    })
    const [block] = buildPipeline([sorter, r1, r2], {})
    const replyGroup = block.groups.find((g) => g.agentId === 'reply')!
    expect(replyGroup.instances).toHaveLength(1) // one instance for sender 'alice'
    expect(replyGroup.instances[0].runs).toHaveLength(2) // two Runs under it
  })

  it('keeps two different keys as two instances', () => {
    const sorter = i({
      localId: 's',
      agentId: 'sorter',
      key: 'sorter',
      isInput: true,
      status: 'running',
    })
    const a = i({
      localId: 'a',
      agentId: 'reply',
      key: 'alice',
      parentLocalId: 's',
      status: 'running',
    })
    const b = i({
      localId: 'b',
      agentId: 'reply',
      key: 'bob',
      parentLocalId: 's',
      status: 'running',
    })
    const [block] = buildPipeline([sorter, a, b], {})
    expect(block.groups.find((g) => g.agentId === 'reply')!.instances).toHaveLength(2)
  })

  it('two scan Runs of the input agent (same key) collapse to one instance', () => {
    const s1 = i({
      localId: 's1',
      agentId: 'sorter',
      key: 'sorter',
      isInput: true,
      status: 'running',
    })
    const s2 = i({
      localId: 's2',
      agentId: 'sorter',
      key: 'sorter',
      isInput: true,
      status: 'running',
    })
    const blocks = buildPipeline([s1, s2], {})
    expect(blocks).toHaveLength(1) // one card, not two
  })

  it('an errored instance stays in the pipeline; a done lone instance recedes', () => {
    const errored = buildPipeline([i({ localId: 'e1', status: 'error', isInput: true })], {})
    expect(errored).toHaveLength(1) // error is live → shown

    const doneOnly = buildPipeline([i({ localId: 'd1', status: 'done', isInput: true })], {})
    expect(doneOnly).toHaveLength(0) // done with no live descendant → recedes
  })

  it('collapsed same-(agentId,key) roots keep children from ALL members (no drop)', () => {
    const s1 = i({
      localId: 's1',
      agentId: 'sorter',
      key: 'sorter',
      isInput: true,
      status: 'running',
    })
    const s2 = i({
      localId: 's2',
      agentId: 'sorter',
      key: 'sorter',
      isInput: true,
      status: 'running',
    })
    const c1 = i({
      localId: 'c1',
      agentId: 'reply',
      key: 'alice',
      parentLocalId: 's1',
      status: 'running',
    })
    const c2 = i({
      localId: 'c2',
      agentId: 'reply',
      key: 'bob',
      parentLocalId: 's2',
      status: 'running',
    })
    const blocks = buildPipeline([s1, s2, c1, c2], {})
    expect(blocks).toHaveLength(1) // one collapsed root card
    const replyGroup = blocks[0].groups.find((g) => g.agentId === 'reply')!
    // BOTH children survive — alice (from s1) AND bob (from s2)
    expect(replyGroup.instances.map((inst) => inst.key).sort()).toEqual(['alice', 'bob'])
  })
})
