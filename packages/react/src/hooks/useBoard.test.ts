import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useBoard, useBoardConnection } from './useBoard'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  closed = false
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>()
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, cb: (e: MessageEvent) => void): void {
    const arr = this.listeners.get(type) ?? []
    arr.push(cb)
    this.listeners.set(type, arr)
  }
  emit(type: string, data = ''): void {
    for (const cb of this.listeners.get(type) ?? []) cb({ data } as MessageEvent)
  }
  close(): void {
    this.closed = true
  }
}

beforeEach(() => {
  FakeEventSource.instances = []
  // @ts-expect-error test shim
  globalThis.EventSource = FakeEventSource
  globalThis.fetch = vi.fn(async () => ({
    json: async () => ({ items: [], gates: [], lastEventId: 0, agentHealth: {} }),
  })) as unknown as typeof fetch
})
afterEach(() => vi.restoreAllMocks())

describe('useBoardConnection', () => {
  it('starts live, flips to reconnecting on SSE error, back to live on open', async () => {
    // useBoardConnection reflects the SINGLETON board stream but does not open it — mount
    // useBoard alongside so the ref-counted /api/board/stream EventSource actually exists.
    const { result } = renderHook(() => {
      useBoard()
      return useBoardConnection()
    })
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    expect(result.current).toBe('live')

    const es = FakeEventSource.instances[0]
    act(() => es.emit('error'))
    await waitFor(() => expect(result.current).toBe('reconnecting'))

    act(() => es.emit('open'))
    await waitFor(() => expect(result.current).toBe('live'))
  })
})
