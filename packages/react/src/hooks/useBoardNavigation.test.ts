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
        status: 'running',
        payload: {},
      },
      {
        id: 'a__reply#2',
        workflowId: 'a',
        agentId: 'a__reply',
        key: 'alice',
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
        status: 'running',
        payload: {},
      },
      {
        id: 'a__reply#2',
        workflowId: 'a',
        agentId: 'a__reply',
        key: 'bob',
        status: 'running',
        payload: {},
      },
    ]
    rerender()
    act(() => result.current.openAgent('reply'))
    expect(result.current.openPickerId).toBe('reply')
    expect(result.current.pickerInstances).toHaveLength(2) // one row per distinct key
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
