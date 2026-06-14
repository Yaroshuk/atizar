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

  it('openAgent: 0 live → type view, 1 → its thread, ≥2 → picker', () => {
    const { result, rerender } = renderHook(() => useBoardNavigation(cfg, 'a'))
    act(() => result.current.openAgent('reply'))
    expect(result.current.openTypeId).toBe('reply')

    // Use the item id as 'a__reply#1' so toPInstances maps localId = 'a__reply#1'
    items = [{ id: 'a__reply#1', workflowId: 'a', agentId: 'a__reply', status: 'running', payload: {} }]
    rerender()
    act(() => result.current.openAgent('reply'))
    expect(result.current.openId).toBe('a__reply#1')

    items = [
      { id: 'a__reply#1', workflowId: 'a', agentId: 'a__reply', status: 'running', payload: {} },
      { id: 'a__reply#2', workflowId: 'a', agentId: 'a__reply', status: 'running', payload: {} },
    ]
    rerender()
    act(() => result.current.openAgent('reply'))
    expect(result.current.openPickerId).toBe('reply')
  })

  it('writes the open id into the ?open= URL', () => {
    items = [{ id: 'a__reply#1', workflowId: 'a', agentId: 'a__reply', status: 'running', payload: {} }]
    const { result } = renderHook(() => useBoardNavigation(cfg, 'a'))
    act(() => result.current.setOpenId('x'))
    expect(new URLSearchParams(window.location.search).get('open')).toBe('x')
  })

  describe('notesFor', () => {
    // parent = qualifier instance in workflow 'a'
    // child  = reply instance in the SAME workflow 'a'
    it('same-workflow child: parent gets sent note with targetLocalId; child gets received note', () => {
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

      // Notes for the parent: one 'sent' note pointing at the child
      const parentNotes = result.current.notesFor(parentId)
      expect(parentNotes).toHaveLength(1)
      expect(parentNotes[0].dir).toBe('sent')
      expect(parentNotes[0].otherName).toBe('R') // nameOf('reply') in workflow 'a'
      expect(parentNotes[0].label).toBe('Lead A') // labelOf(child) via payload.subject
      expect(parentNotes[0].targetLocalId).toBe(childId) // same-workflow → set
      expect(parentNotes[0].targetWorkflow).toBeUndefined() // same-workflow → absent

      // Notes for the child: one 'received' note from the parent
      const childNotes = result.current.notesFor(childId)
      expect(childNotes).toHaveLength(1)
      expect(childNotes[0].dir).toBe('received')
      expect(childNotes[0].otherName).toBe('Qualifier') // nameOf('qualifier') in workflow 'a'
      expect(childNotes[0].label).toBe('Lead A') // labelOf(child) — label is on the child item
      expect(childNotes[0].targetLocalId).toBeUndefined()
      expect(childNotes[0].targetWorkflow).toBeUndefined()
    })

    // parent = qualifier instance in workflow 'a'
    // child  = reply instance in a DIFFERENT workflow 'b'
    it('cross-workflow child: sent note has targetWorkflow set and targetLocalId absent', () => {
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
      expect(parentNotes).toHaveLength(1)
      expect(parentNotes[0].dir).toBe('sent')
      // stripAgent(child) = 'b__reply'.slice('b'.length + 2) = 'reply'
      // nameOf('reply') looks up workflow 'a' → finds agent id 'reply', name 'R'
      expect(parentNotes[0].otherName).toBe('R')
      expect(parentNotes[0].label).toBe('Cross lead')
      expect(parentNotes[0].targetWorkflow).toBe('b') // cross-workflow → set
      expect(parentNotes[0].targetLocalId).toBeUndefined() // cross-workflow → absent
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
  })
})
