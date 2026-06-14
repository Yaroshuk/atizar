import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const items: any[] = []
vi.mock('./useBoard', () => ({ useBoard: () => ({ items, agentHealth: {} }) }))
import { useWorkflowSelection } from './useWorkflowSelection'

const cfg: any = { workflows: [{ id: 'a' }, { id: 'b' }], meta: {}, renders: [], hitl: [] }

describe('useWorkflowSelection', () => {
  beforeEach(() => {
    items.length = 0
  })
  it('defaults to the first workflow and counts active items', () => {
    items.push({ id: '1', workflowId: 'a', status: 'running' })
    items.push({ id: '2', workflowId: 'b', status: 'finished' })
    const { result } = renderHook(() => useWorkflowSelection(cfg))
    expect(result.current.activeWorkflowId).toBe('a')
    expect(result.current.globalActive).toBe(1)
    expect(result.current.workflowActiveCount).toBe(1)
  })
  it('badges unseen cross-workflow children, clears them on switch', () => {
    items.push({ id: 'p', workflowId: 'a', status: 'finished' })
    items.push({ id: 'c', workflowId: 'b', status: 'running', parentId: 'p' })
    const { result } = renderHook(() => useWorkflowSelection(cfg))
    expect(result.current.unread.b).toBe(1)
    act(() => result.current.switchWorkflow('b'))
    expect(result.current.activeWorkflowId).toBe('b')
    expect(result.current.unread.b ?? 0).toBe(0)
  })
})
