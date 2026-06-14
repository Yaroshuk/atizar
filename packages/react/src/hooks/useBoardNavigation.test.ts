import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

let items: any[] = []
const start = vi.fn(async () => 'new-id')
vi.mock('./useBoard', () => ({ useBoard: () => ({ items, agentHealth: {} }) }))
vi.mock('./useDispatch', () => ({ useDispatch: () => ({ start }) }))
import { useBoardNavigation } from './useBoardNavigation'

const cfg: any = {
  workflows: [
    { id: 'a', agents: [{ agent: { id: 'reply', name: 'R' }, role: 'worker' }] },
  ],
  meta: { reply: { iconName: 'inbox' } },
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
})
