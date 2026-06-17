import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { instanceId } from '@atizar/core'

let items: any[] = []
const start = vi.fn(async () => 'new-id')
vi.mock('./useBoard', () => ({ useBoard: () => ({ items, agentHealth: {} }) }))
vi.mock('./useDispatch', () => ({ useDispatch: () => ({ start }) }))
import { useBoardNavigation } from './useBoardNavigation'

// Config with two agents in the active workflow 'a':
//   qualifier (input) + reply (worker)
// and a second workflow 'b' with its own reply agent — used for cross-workflow notes.
const cfg: any = {
  workflows: [
    {
      id: 'a',
      agents: [
        { agent: { id: 'qualifier', name: 'Qualifier' }, role: 'input' },
        { agent: { id: 'reply', name: 'R' }, role: 'worker' },
      ],
    },
    {
      id: 'b',
      agents: [{ agent: { id: 'reply', name: 'Reply-B' }, role: 'worker' }],
    },
  ],
  meta: { qualifier: { iconName: 'inbox' }, reply: { iconName: 'inbox' } },
  renders: [],
  hitl: [],
}

describe('useBoardNavigation', () => {
  beforeEach(() => {
    items = []
    start.mockClear()
    window.history.replaceState(null, '', '/')
  })

  it('openAgent counts INSTANCES by key: 0 → type view, 1 instance → its head, ≥2 → picker', () => {
    const { result, rerender } = renderHook(() => useBoardNavigation(cfg, 'a'))
    act(() => result.current.openAgent('reply'))
    expect(result.current.openTypeId).toBe('reply')

    // One instance (key 'alice'), even with TWO Runs sharing that key → open the head run.
    items = [
      {
        id: 'a__reply#1',
        workflowId: 'a',
        agentId: 'a__reply',
        key: 'alice',
        phase: 'active',
        outcome: 'running',
        card: null,
        parentId: null,
        status: 'running',
        payload: {},
      },
      {
        id: 'a__reply#2',
        workflowId: 'a',
        agentId: 'a__reply',
        key: 'alice',
        phase: 'active',
        outcome: 'running',
        card: null,
        parentId: null,
        status: 'running',
        payload: {},
      },
    ]
    rerender()
    act(() => result.current.openAgent('reply'))
    // 1 distinct instance → openId is a head Run's localId (one of the two Runs of key 'alice').
    expect(['a__reply#1', 'a__reply#2']).toContain(result.current.openId)
    expect(result.current.openPickerId).toBeNull()

    // Two distinct instances (keys 'alice' + 'bob') → picker.
    items = [
      {
        id: 'a__reply#1',
        workflowId: 'a',
        agentId: 'a__reply',
        key: 'alice',
        phase: 'active',
        outcome: 'running',
        card: null,
        parentId: null,
        status: 'running',
        payload: {},
      },
      {
        id: 'a__reply#2',
        workflowId: 'a',
        agentId: 'a__reply',
        key: 'bob',
        phase: 'active',
        outcome: 'running',
        card: null,
        parentId: null,
        status: 'running',
        payload: {},
      },
    ]
    rerender()
    act(() => result.current.openAgent('reply'))
    expect(result.current.openPickerId).toBe('reply')
    expect(result.current.pickerInstances).toHaveLength(2) // one row per distinct key
  })

  // R4-stopped / R5-stopped: use phase:'terminal', outcome:'stopped' which lifecycle() marks
  // isVisible:true (HUMAN_TERMINAL) but displayStatus() → 'done' → isLive('done') === false.
  // These are the LOAD-BEARING cases: the upstream visibility filter does NOT exclude them —
  // only the isLive filter in instancesOf does. (The old R4/R5 use phase:'done' which is not a
  // valid Phase, so lifecycle isVisible=false excludes them before instancesOf even runs.)

  it('R4-stopped: a visible-but-terminal (stopped) lone instance recedes — openAgent routes to the type view', () => {
    items = [
      {
        id: 'a__reply#1',
        workflowId: 'a',
        agentId: 'a__reply',
        key: 'alice',
        phase: 'terminal',
        status: 'done',
        outcome: 'stopped',
        card: null,
        parentId: null,
        payload: {},
      },
    ]
    const { result } = renderHook(() => useBoardNavigation(cfg, 'a'))
    act(() => result.current.openAgent('reply'))
    // stopped instance is board-visible (lifecycle isVisible:true via HUMAN_TERMINAL),
    // but isLive('done')===false → instancesOf returns 0 items → type view.
    expect(result.current.openTypeId).toBe('reply')
    expect(result.current.openId).toBeNull()
    expect(result.current.openPickerId).toBeNull()
  })

  it('R5-stopped: [1 running, 1 stopped] opens only the LIVE thread; stopped excluded from picker', () => {
    items = [
      {
        id: 'a__reply#1',
        workflowId: 'a',
        agentId: 'a__reply',
        key: 'alice',
        phase: 'active',
        status: 'running',
        outcome: 'running',
        card: null,
        parentId: null,
        payload: {},
      },
      {
        id: 'a__reply#2',
        workflowId: 'a',
        agentId: 'a__reply',
        key: 'bob',
        phase: 'terminal',
        status: 'done',
        outcome: 'stopped',
        card: null,
        parentId: null,
        payload: {},
      },
    ]
    const { result } = renderHook(() => useBoardNavigation(cfg, 'a'))
    act(() => result.current.openAgent('reply'))
    // stopped is board-visible; without the isLive filter instancesOf would return 2 items
    // and trigger the picker — the filter is load-bearing here.
    expect(result.current.openId).toBe('a__reply#1') // single LIVE thread
    expect(result.current.openPickerId).toBeNull() // no picker
    // pickerInstances (if it were opened) would also exclude the stopped instance
    expect(result.current.instancesOf('reply')).toHaveLength(1)
    expect(result.current.instancesOf('reply')[0].localId).toBe('a__reply#1')
  })

  it('R4: a lone TERMINAL instance does not route to a dead thread — opens the type view', () => {
    items = [
      {
        id: 'a__reply#1',
        workflowId: 'a',
        agentId: 'a__reply',
        key: 'alice',
        phase: 'done',
        status: 'done',
        outcome: 'done',
        card: null,
        parentId: null,
        payload: {},
      },
    ]
    const { result } = renderHook(() => useBoardNavigation(cfg, 'a'))
    act(() => result.current.openAgent('reply'))
    expect(result.current.openTypeId).toBe('reply') // 0 LIVE instances → type view
    expect(result.current.openId).toBeNull()
    expect(result.current.openPickerId).toBeNull()
  })

  it('R5: [1 running, 1 done] opens the single LIVE thread, not the picker', () => {
    items = [
      {
        id: 'a__reply#1',
        workflowId: 'a',
        agentId: 'a__reply',
        key: 'alice',
        phase: 'active',
        status: 'running',
        outcome: 'running',
        card: null,
        parentId: null,
        payload: {},
      },
      {
        id: 'a__reply#2',
        workflowId: 'a',
        agentId: 'a__reply',
        key: 'bob',
        phase: 'done',
        status: 'done',
        outcome: 'done',
        card: null,
        parentId: null,
        payload: {},
      },
    ]
    const { result } = renderHook(() => useBoardNavigation(cfg, 'a'))
    act(() => result.current.openAgent('reply'))
    expect(result.current.openId).toBe('a__reply#1') // count = 1 live → its thread
    expect(result.current.openPickerId).toBeNull()
  })

  it('PK1: the picker lists only LIVE instances (a done instance does not appear)', () => {
    items = [
      {
        id: 'a__reply#1',
        workflowId: 'a',
        agentId: 'a__reply',
        key: 'alice',
        phase: 'active',
        status: 'running',
        outcome: 'running',
        card: null,
        parentId: null,
        payload: {},
      },
      {
        id: 'a__reply#2',
        workflowId: 'a',
        agentId: 'a__reply',
        key: 'bob',
        phase: 'awaiting_human',
        status: 'awaiting_approval',
        outcome: 'running',
        card: {},
        parentId: null,
        payload: {},
      },
      {
        id: 'a__reply#3',
        workflowId: 'a',
        agentId: 'a__reply',
        key: 'carol',
        phase: 'done',
        status: 'done',
        outcome: 'done',
        card: null,
        parentId: null,
        payload: {},
      },
    ]
    const { result } = renderHook(() => useBoardNavigation(cfg, 'a'))
    act(() => result.current.openAgent('reply'))
    expect(result.current.openPickerId).toBe('reply') // 2 live instances → picker
    expect(result.current.pickerInstances).toHaveLength(2) // carol (done) excluded
    expect(result.current.pickerInstances.map((p) => p.key).sort()).toEqual(['alice', 'bob'])
  })

  it('writes the open id into the ?open= URL', () => {
    items = [
      { id: 'a__reply#1', workflowId: 'a', agentId: 'a__reply', status: 'running', payload: {} },
    ]
    const { result } = renderHook(() => useBoardNavigation(cfg, 'a'))
    act(() => result.current.setOpenId('x'))
    expect(new URLSearchParams(window.location.search).get('open')).toBe('x')
  })

  describe('notesFor', () => {
    // parent = qualifier instance in workflow 'a'
    // child  = reply instance in the SAME workflow 'a'
    // Task 5: the parent no longer gets a 'sent' note from board topology — "Handed to X" is
    // now rendered inline via the trace handoff event. The child still gets a 'received' note.
    it('same-workflow child: parent gets NO sent note; child gets received note', () => {
      const parentId = 'a__qualifier#1'
      const childId = 'a__reply#1'
      items = [
        {
          id: parentId,
          workflowId: 'a',
          agentId: 'a__qualifier',
          parentId: null,
          status: 'running',
          payload: { subject: 'Lead A' },
          resolution: null,
          card: null,
          error: null,
          origin: 'human',
          source: null,
        },
        {
          id: childId,
          workflowId: 'a',
          agentId: 'a__reply',
          parentId: parentId,
          status: 'running',
          payload: { subject: 'Lead A' },
          resolution: null,
          card: null,
          error: null,
          origin: 'agent',
          source: null,
        },
      ]
      const { result } = renderHook(() => useBoardNavigation(cfg, 'a'))

      // Notes for the parent: no notes (sent is gone — handoff is now a trace event)
      const parentNotes = result.current.notesFor(parentId)
      expect(parentNotes).toHaveLength(0)

      // Notes for the child: one 'received' note from the parent
      const childNotes = result.current.notesFor(childId)
      expect(childNotes).toHaveLength(1)
      expect(childNotes[0].dir).toBe('received')
      expect(childNotes[0].otherName).toBe('Qualifier') // nameOf('qualifier') in workflow 'a'
      expect(childNotes[0].label).toBe('Lead A') // labelOf(child) — label is on the child item
    })

    // Task 5: cross-workflow child no longer produces a sent note on the parent.
    it('cross-workflow child: parent gets NO sent note (sent is a trace event now)', () => {
      const parentId = 'a__qualifier#1'
      const crossChildId = 'b__reply#1'
      items = [
        {
          id: parentId,
          workflowId: 'a',
          agentId: 'a__qualifier',
          parentId: null,
          status: 'running',
          payload: { subject: 'Cross lead' },
          resolution: null,
          card: null,
          error: null,
          origin: 'human',
          source: null,
        },
        {
          id: crossChildId,
          workflowId: 'b',
          agentId: 'b__reply',
          parentId: parentId,
          status: 'running',
          payload: { subject: 'Cross lead' },
          resolution: null,
          card: null,
          error: null,
          origin: 'agent',
          source: null,
        },
      ]
      const { result } = renderHook(() => useBoardNavigation(cfg, 'a'))

      const parentNotes = result.current.notesFor(parentId)
      expect(parentNotes).toHaveLength(0)
    })

    it('notesFor never returns sent notes — handoff is a trace event (Task 5)', () => {
      // Even when a child work item exists in the board, notesFor must not emit 'sent' notes.
      // The "Handed to X" line is now rendered inline via the trace handoff event (Task 4).
      const parentId = 'a__qualifier#1'
      const childId = 'a__reply#1'
      items = [
        {
          id: parentId,
          workflowId: 'a',
          agentId: 'a__qualifier',
          parentId: null,
          status: 'running',
          payload: { subject: 'Lead A' },
          resolution: null,
          card: null,
          error: null,
          origin: 'human',
          source: null,
        },
        {
          id: childId,
          workflowId: 'a',
          agentId: 'a__reply',
          parentId: parentId,
          status: 'running',
          payload: { subject: 'Lead A' },
          resolution: null,
          card: null,
          error: null,
          origin: 'agent',
          source: null,
        },
      ]
      const { result } = renderHook(() => useBoardNavigation(cfg, 'a'))
      expect(result.current.notesFor(parentId).every((n) => n.dir === 'received')).toBe(true)
    })

    it('item with no parent and no children returns []', () => {
      items = [
        {
          id: 'a__qualifier#1',
          workflowId: 'a',
          agentId: 'a__qualifier',
          parentId: null,
          status: 'running',
          payload: {},
          resolution: null,
          card: null,
          error: null,
          origin: 'human',
          source: null,
        },
      ]
      const { result } = renderHook(() => useBoardNavigation(cfg, 'a'))
      expect(result.current.notesFor('a__qualifier#1')).toEqual([])
    })
  })

  // START is a plain dispatch now — no client-side wipe/Start-over confirm (the server handles
  // re-scan safety: supersede-prior + one-live gate). Even a live singleton input agent dispatches
  // straight away.
  it('INPUT open item: openRuns returns ONLY the latest EPISODE (no stacking of prior scans)', () => {
    // Three scan roots sharing the input agent's CONSTANT key — each a fresh episode (the prior
    // scan fully receded before the next re-START), so episodeSeq increases 1→2→3. scan-1 and
    // scan-2 are done with a card (hasCard → isVisible); scan-3 is running. currentEpisode keeps
    // only the highest episodeSeq → scan-3.
    items = [
      {
        id: 'scan-1',
        workflowId: 'a',
        agentId: 'a__qualifier',
        key: 'qualifier',
        episodeSeq: 1,
        phase: 'terminal',
        outcome: 'done',
        status: 'done',
        card: {},
        parentId: null,
        payload: {},
      },
      {
        id: 'scan-2',
        workflowId: 'a',
        agentId: 'a__qualifier',
        key: 'qualifier',
        episodeSeq: 2,
        phase: 'terminal',
        outcome: 'done',
        status: 'done',
        card: {},
        parentId: null,
        payload: {},
      },
      {
        id: 'scan-3',
        workflowId: 'a',
        agentId: 'a__qualifier',
        key: 'qualifier',
        episodeSeq: 3,
        phase: 'active',
        outcome: 'running',
        status: 'running',
        card: null,
        parentId: null,
        payload: {},
      },
    ]
    const { result } = renderHook(() => useBoardNavigation(cfg, 'a'))
    act(() => result.current.setOpenId('scan-1')) // open via ANY of the instance's runs
    // Only the latest episode's scan is rendered in the input thread (no stacking).
    expect(result.current.openRuns.map((r) => r.localId)).toEqual(['scan-3'])
  })

  it('WORKER open item: openRuns keeps ALL runs of the CURRENT episode (a sender keeps every draft)', () => {
    // Two drafts of one sender within one continuous live span → same episodeSeq → both show.
    items = [
      {
        id: 'd1',
        workflowId: 'a',
        agentId: 'a__reply',
        key: 'alice',
        episodeSeq: 1,
        phase: 'awaiting_human',
        outcome: 'running',
        status: 'awaiting_approval',
        card: {},
        parentId: null,
        payload: {},
      },
      {
        id: 'd2',
        workflowId: 'a',
        agentId: 'a__reply',
        key: 'alice',
        episodeSeq: 1,
        phase: 'active',
        outcome: 'running',
        status: 'running',
        card: null,
        parentId: null,
        payload: {},
      },
    ]
    const { result } = renderHook(() => useBoardNavigation(cfg, 'a'))
    act(() => result.current.setOpenId('d1'))
    expect(result.current.openRuns.map((r) => r.localId).sort()).toEqual(['d1', 'd2'])
  })

  describe('startInput', () => {
    it('calls start with the correct instanceId and sets openId to the returned id', async () => {
      const returnedId = 'a__qualifier#42'
      start.mockResolvedValueOnce(returnedId)

      const def: any = { id: 'qualifier', name: 'Qualifier' }
      const { result } = renderHook(() => useBoardNavigation(cfg, 'a'))

      // First open the type view so we can verify it gets cleared
      act(() => result.current.setOpenTypeId('qualifier'))
      expect(result.current.openTypeId).toBe('qualifier')

      await act(async () => {
        result.current.startInput(def)
      })

      expect(start).toHaveBeenCalledWith(instanceId('a', 'qualifier'))
      expect(result.current.openTypeId).toBeNull()
      expect(result.current.openId).toBe(returnedId)
    })

    it('a LIVE singleton input agent dispatches directly — no Start-over confirm', () => {
      const singletonDef: any = { id: 'qualifier', name: 'Qualifier', maxInstances: 1 }
      items = [
        {
          id: 'a__qualifier#1',
          workflowId: 'a',
          agentId: 'a__qualifier',
          key: 'inbox',
          parentId: null,
          phase: 'active',
          status: 'running',
          payload: {},
        },
      ]
      const { result } = renderHook(() => useBoardNavigation(cfg, 'a'))
      act(() => result.current.startInput(singletonDef))
      expect(start).toHaveBeenCalledWith(instanceId('a', 'qualifier'))
    })
  })
})
