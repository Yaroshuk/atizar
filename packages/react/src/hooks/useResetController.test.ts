import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const resetWorkflow = vi.fn(async () => ({ reset: 0, active: 0 }))
const resetAll = vi.fn(async () => ({ reset: 0, active: 0 }))
const cancelWorkflow = vi.fn(async () => {})
const cancelAll = vi.fn(async () => {})
vi.mock('./useDispatch', () => ({
  useDispatch: () => ({ resetWorkflow, resetAll, cancelWorkflow, cancelAll }),
}))

// Board items the controller counts. Mutable so each test sets the scope it needs.
let items: { id: string; workflowId: string; status: string }[] = []
vi.mock('./useBoard', () => ({ useBoard: () => ({ items }) }))

import { useResetController } from './useResetController'

const order: string[] = []
beforeEach(() => {
  resetWorkflow.mockClear()
  resetAll.mockClear()
  cancelWorkflow.mockClear()
  cancelAll.mockClear()
  order.length = 0
  cancelAll.mockImplementation(async () => void order.push('cancelAll'))
  resetAll.mockImplementation(async () => {
    order.push('resetAll')
    return { reset: 0, active: 0 }
  })
  cancelWorkflow.mockImplementation(async () => void order.push('cancelWorkflow'))
  resetWorkflow.mockImplementation(async () => {
    order.push('resetWorkflow')
    return { reset: 0, active: 0 }
  })
  items = []
})

describe('useResetController — a click does NOTHING until confirmed', () => {
  it('requestResetAll opens a confirm and touches NOTHING (no cancel, no reset)', () => {
    items = [
      { id: 'a', workflowId: 'wf-a', status: 'running' },
      { id: 'b', workflowId: 'wf-a', status: 'finished' },
      { id: 'c', workflowId: 'wf-b', status: 'awaiting_approval' },
    ]
    const { result } = renderHook(() => useResetController('wf-a'))
    act(() => result.current.requestResetAll())
    // confirm counts EVERY non-closed item across all workflows (running ones included)
    expect(result.current.confirm).toEqual({ kind: 'all', count: 3 })
    expect(cancelAll).not.toHaveBeenCalled()
    expect(resetAll).not.toHaveBeenCalled()
  })

  it('requestResetWorkflow counts only the active workflow, still touches nothing', () => {
    items = [
      { id: 'a', workflowId: 'wf-a', status: 'running' },
      { id: 'b', workflowId: 'wf-a', status: 'closed' }, // already retired → not counted
      { id: 'c', workflowId: 'wf-b', status: 'running' }, // other workflow → not counted
    ]
    const { result } = renderHook(() => useResetController('wf-a'))
    act(() => result.current.requestResetWorkflow())
    expect(result.current.confirm).toEqual({ kind: 'workflow', count: 1 })
    expect(cancelWorkflow).not.toHaveBeenCalled()
    expect(resetWorkflow).not.toHaveBeenCalled()
  })

  it('an empty scope is a no-op (no confirm opened)', () => {
    items = [{ id: 'a', workflowId: 'wf-a', status: 'closed' }]
    const { result } = renderHook(() => useResetController('wf-a'))
    act(() => result.current.requestResetAll())
    expect(result.current.confirm).toBeNull()
  })

  it('cancelConfirm closes the dialog and changes NOTHING', () => {
    items = [{ id: 'a', workflowId: 'wf-a', status: 'running' }]
    const { result } = renderHook(() => useResetController('wf-a'))
    act(() => result.current.requestResetAll())
    act(() => result.current.cancelConfirm())
    expect(result.current.confirm).toBeNull()
    expect(cancelAll).not.toHaveBeenCalled()
    expect(resetAll).not.toHaveBeenCalled()
  })

  it('confirmReset (all) STOPS active items first, THEN clears — a full wipe', async () => {
    items = [{ id: 'a', workflowId: 'wf-a', status: 'running' }]
    const { result } = renderHook(() => useResetController('wf-a'))
    act(() => result.current.requestResetAll())
    await act(async () => {
      await result.current.confirmReset()
    })
    expect(order).toEqual(['cancelAll', 'resetAll']) // cancel BEFORE reset
    expect(result.current.confirm).toBeNull()
  })

  it('confirmReset (workflow) cancels then resets the active workflow', async () => {
    items = [{ id: 'a', workflowId: 'wf-a', status: 'awaiting_approval' }]
    const { result } = renderHook(() => useResetController('wf-a'))
    act(() => result.current.requestResetWorkflow())
    await act(async () => {
      await result.current.confirmReset()
    })
    expect(cancelWorkflow).toHaveBeenCalledWith('wf-a')
    expect(order).toEqual(['cancelWorkflow', 'resetWorkflow'])
  })
})
