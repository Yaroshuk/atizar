import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const cancel = vi.fn(async () => {})
const cancelWorkflow = vi.fn(async () => {})
const cancelAll = vi.fn(async () => {})
const cancelInstance = vi.fn(async () => {})
let items: any[] = []
vi.mock('./useBoard', () => ({ useBoard: () => ({ items }) }))
vi.mock('./useDispatch', () => ({
  useDispatch: () => ({ cancel, cancelWorkflow, cancelAll, cancelInstance }),
}))
import { useStopController } from './useStopController'

describe('useStopController', () => {
  beforeEach(() => {
    cancel.mockClear()
    cancelWorkflow.mockClear()
    cancelAll.mockClear()
    cancelInstance.mockClear()
    items = []
  })

  it('starts with confirm=null and no stopping flags', () => {
    const { result } = renderHook(() => useStopController('wf-a'))
    expect(result.current.confirm).toBeNull()
    expect(result.current.stoppingWorkflow).toBe(false)
    expect(result.current.stoppingAll).toBe(false)
    expect(result.current.stoppingItems).toEqual({})
  })

  it('requestStopItem sets confirm to item scope', () => {
    const { result } = renderHook(() => useStopController('wf-a'))
    act(() => result.current.requestStopItem('w1'))
    expect(result.current.confirm).toEqual({ kind: 'item', id: 'w1' })
  })

  it('requestStopWorkflow sets confirm to workflow scope', () => {
    const { result } = renderHook(() => useStopController('wf-a'))
    act(() => result.current.requestStopWorkflow())
    expect(result.current.confirm).toEqual({ kind: 'workflow' })
  })

  it('requestStopAll sets confirm to all scope', () => {
    const { result } = renderHook(() => useStopController('wf-a'))
    act(() => result.current.requestStopAll())
    expect(result.current.confirm).toEqual({ kind: 'all' })
  })

  it('cancelConfirm clears confirm without calling any canceller', () => {
    const { result } = renderHook(() => useStopController('wf-a'))
    act(() => result.current.requestStopItem('w1'))
    act(() => result.current.cancelConfirm())
    expect(result.current.confirm).toBeNull()
    expect(cancel).not.toHaveBeenCalled()
  })

  it('confirmStop is a no-op when confirm is null', async () => {
    const { result } = renderHook(() => useStopController('wf-a'))
    await act(async () => {
      await result.current.confirmStop()
    })
    expect(cancel).not.toHaveBeenCalled()
    expect(cancelWorkflow).not.toHaveBeenCalled()
    expect(cancelAll).not.toHaveBeenCalled()
  })

  // --- item scope (= the whole INSTANCE) ---
  it('confirming an item resolves it to (workflowId, agentId, key) and calls cancelInstance', async () => {
    items = [{ id: 'w1', workflowId: 'a', agentId: 'a__reply', key: 'alice' }]
    const { result } = renderHook(() => useStopController('wf-a'))
    act(() => result.current.requestStopItem('w1'))
    expect(result.current.confirm).toEqual({ kind: 'item', id: 'w1' })
    await act(async () => {
      await result.current.confirmStop()
    })
    expect(cancelInstance).toHaveBeenCalledWith('a', 'a__reply', 'alice')
    expect(cancel).not.toHaveBeenCalled()
    expect(result.current.confirm).toBeNull()
  })

  it('falls back to cancel(id) when the item id cannot be resolved on the board', async () => {
    items = [] // 'w1' not on the board
    const { result } = renderHook(() => useStopController('wf-a'))
    act(() => result.current.requestStopItem('w1'))
    await act(async () => {
      await result.current.confirmStop()
    })
    expect(cancel).toHaveBeenCalledWith('w1')
    expect(cancelInstance).not.toHaveBeenCalled()
    expect(result.current.confirm).toBeNull()
  })

  it('item stop tracks stoppingItems[id]=true while cancel is in-flight, clears after', async () => {
    let resolveFn!: () => void
    cancel.mockImplementationOnce(
      () =>
        new Promise<void>((res) => {
          resolveFn = res
        })
    )
    const { result } = renderHook(() => useStopController('wf-a'))
    act(() => result.current.requestStopItem('w2'))

    // Kick off confirmStop without awaiting — lets us inspect mid-flight state
    let done = false
    act(() => {
      void result.current.confirmStop().then(() => {
        done = true
      })
    })
    expect(result.current.stoppingItems['w2']).toBe(true)
    expect(result.current.confirm).toBeNull() // cleared eagerly before await

    await act(async () => {
      resolveFn()
    })
    expect(result.current.stoppingItems['w2']).toBeUndefined()
    expect(done).toBe(true)
  })

  // --- workflow scope ---
  it('confirming workflow scope calls cancelWorkflow with activeWorkflowId', async () => {
    const { result } = renderHook(() => useStopController('wf-a'))
    act(() => result.current.requestStopWorkflow())
    await act(async () => {
      await result.current.confirmStop()
    })
    expect(cancelWorkflow).toHaveBeenCalledWith('wf-a')
    expect(result.current.confirm).toBeNull()
  })

  it('workflow stop sets stoppingWorkflow=true during cancel, resets after', async () => {
    let resolveFn!: () => void
    cancelWorkflow.mockImplementationOnce(
      () =>
        new Promise<void>((res) => {
          resolveFn = res
        })
    )
    const { result } = renderHook(() => useStopController('wf-a'))
    act(() => result.current.requestStopWorkflow())

    act(() => {
      void result.current.confirmStop()
    })
    expect(result.current.stoppingWorkflow).toBe(true)

    await act(async () => {
      resolveFn()
    })
    expect(result.current.stoppingWorkflow).toBe(false)
    expect(result.current.confirm).toBeNull()
  })

  // --- all scope ---
  it('confirming all scope calls cancelAll and clears confirm', async () => {
    const { result } = renderHook(() => useStopController('wf-a'))
    act(() => result.current.requestStopAll())
    await act(async () => {
      await result.current.confirmStop()
    })
    expect(cancelAll).toHaveBeenCalled()
    expect(result.current.confirm).toBeNull()
  })

  it('all stop sets stoppingAll=true during cancel, resets after', async () => {
    let resolveFn!: () => void
    cancelAll.mockImplementationOnce(
      () =>
        new Promise<void>((res) => {
          resolveFn = res
        })
    )
    const { result } = renderHook(() => useStopController('wf-a'))
    act(() => result.current.requestStopAll())

    act(() => {
      void result.current.confirmStop()
    })
    expect(result.current.stoppingAll).toBe(true)

    await act(async () => {
      resolveFn()
    })
    expect(result.current.stoppingAll).toBe(false)
    expect(result.current.confirm).toBeNull()
  })
})
