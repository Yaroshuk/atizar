import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const resetWorkflow = vi.fn(async () => ({ reset: 0 }))
const resetAll = vi.fn(async () => ({ reset: 0 }))
vi.mock('./useDispatch', () => ({
  useDispatch: () => ({ resetWorkflow, resetAll }),
}))

// Board items the controller counts. Mutable so each test sets the scope it needs.
let items: { id: string; workflowId: string; phase: string; outcome: string }[] = []
vi.mock('./useBoard', () => ({ useBoard: () => ({ items }) }))

import { useResetController } from './useResetController'

const order: string[] = []
beforeEach(() => {
  resetWorkflow.mockClear()
  resetAll.mockClear()
  order.length = 0
  resetAll.mockImplementation(async () => {
    order.push('resetAll')
    return { reset: 0 }
  })
  resetWorkflow.mockImplementation(async () => {
    order.push('resetWorkflow')
    return { reset: 0 }
  })
  items = []
})

describe('useResetController — a click does NOTHING until confirmed', () => {
  it('requestResetAll opens a confirm and touches NOTHING (no reset)', () => {
    items = [
      { id: 'a', workflowId: 'wf-a', phase: 'active', outcome: 'running' },
      { id: 'b', workflowId: 'wf-a', phase: 'terminal', outcome: 'done' },
      { id: 'c', workflowId: 'wf-b', phase: 'awaiting_human', outcome: 'running' },
    ]
    const { result } = renderHook(() => useResetController('wf-a'))
    act(() => result.current.requestResetAll())
    // confirm counts EVERY board item across all workflows (the board has no retired rows)
    expect(result.current.confirm).toEqual({ kind: 'all', count: 3 })
    expect(resetAll).not.toHaveBeenCalled()
  })

  it('requestResetWorkflow counts only the active workflow, still touches nothing', () => {
    items = [
      { id: 'a', workflowId: 'wf-a', phase: 'active', outcome: 'running' },
      { id: 'b', workflowId: 'wf-a', phase: 'queued', outcome: 'running' }, // queued IS counted
      { id: 'c', workflowId: 'wf-b', phase: 'active', outcome: 'running' }, // other workflow → not counted
    ]
    const { result } = renderHook(() => useResetController('wf-a'))
    act(() => result.current.requestResetWorkflow())
    expect(result.current.confirm).toEqual({ kind: 'workflow', count: 2 })
    expect(resetWorkflow).not.toHaveBeenCalled()
  })

  it('an empty scope is a no-op (no confirm opened)', () => {
    items = []
    const { result } = renderHook(() => useResetController('wf-a'))
    act(() => result.current.requestResetAll())
    expect(result.current.confirm).toBeNull()
  })

  it('cancelConfirm closes the dialog and changes NOTHING', () => {
    items = [{ id: 'a', workflowId: 'wf-a', phase: 'active', outcome: 'running' }]
    const { result } = renderHook(() => useResetController('wf-a'))
    act(() => result.current.requestResetAll())
    act(() => result.current.cancelConfirm())
    expect(result.current.confirm).toBeNull()
    expect(resetAll).not.toHaveBeenCalled()
  })

  it('confirmReset (all) calls ONLY resetAll — the server wipes (cancel + clear) atomically', async () => {
    items = [{ id: 'a', workflowId: 'wf-a', phase: 'active', outcome: 'running' }]
    const { result } = renderHook(() => useResetController('wf-a'))
    act(() => result.current.requestResetAll())
    await act(async () => {
      await result.current.confirmReset()
    })
    expect(order).toEqual(['resetAll'])
    expect(result.current.confirm).toBeNull()
  })

  it('confirmReset (workflow) calls ONLY resetWorkflow for the active workflow', async () => {
    items = [{ id: 'a', workflowId: 'wf-a', phase: 'awaiting_human', outcome: 'running' }]
    const { result } = renderHook(() => useResetController('wf-a'))
    act(() => result.current.requestResetWorkflow())
    await act(async () => {
      await result.current.confirmReset()
    })
    expect(resetWorkflow).toHaveBeenCalledWith('wf-a')
    expect(order).toEqual(['resetWorkflow'])
  })
})
