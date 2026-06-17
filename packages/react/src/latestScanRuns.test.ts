import { describe, expect, it } from 'vitest'
import { latestScanRuns } from './latestScanRuns.js'
import type { PInstance } from './pipelineModel'

// Minimal PInstance fixture — only the fields the selector reads (localId) plus the
// type-required ones. Board order is creation order: oldest first, newest LAST.
const run = (localId: string, over: Partial<PInstance> = {}): PInstance => ({
  localId,
  runtimeKey: 'a__sorter',
  agentId: 'sorter',
  key: 'sorter', // constant key → all scans collapse into one instance
  name: 'Sorter',
  iconName: 'inbox',
  label: 'INBOX SORTED',
  status: 'done',
  outcome: 'done',
  isInput: true,
  ...over,
})

describe('latestScanRuns', () => {
  it('input agent: returns only the LATEST scan (last in board/creation order)', () => {
    const runs = [run('scan-1'), run('scan-2'), run('scan-3')] // 3 stacked scans
    expect(latestScanRuns(runs, true).map((r) => r.localId)).toEqual(['scan-3'])
  })

  it('input agent with a single scan: returns that scan', () => {
    const runs = [run('scan-1')]
    expect(latestScanRuns(runs, true).map((r) => r.localId)).toEqual(['scan-1'])
  })

  it('worker agent: returns ALL runs unchanged (a sender keeps every draft)', () => {
    const drafts = [
      run('draft-1', { agentId: 'reply', key: 'alice', isInput: false }),
      run('draft-2', { agentId: 'reply', key: 'alice', isInput: false }),
    ]
    expect(latestScanRuns(drafts, false)).toBe(drafts) // same reference, not narrowed
    expect(latestScanRuns(drafts, false).map((r) => r.localId)).toEqual(['draft-1', 'draft-2'])
  })

  it('empty input: returns [] for both roles', () => {
    expect(latestScanRuns([], true)).toEqual([])
    expect(latestScanRuns([], false)).toEqual([])
  })
})
