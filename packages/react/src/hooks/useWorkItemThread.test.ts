import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useWorkItemThread } from './useWorkItemThread'

// A minimal EventSource mock that records instances and lets the test fire named events.
class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  closed = false
  onmessage: ((e: MessageEvent) => void) | null = null
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
  emit(type: string, data: string): void {
    for (const cb of this.listeners.get(type) ?? []) cb({ data } as MessageEvent)
  }
  close(): void {
    this.closed = true
  }
}

const snapshot = (over: Partial<{ status: string; done: boolean; nextSeq: number }>) => ({
  status: 'active',
  done: false,
  nextSeq: 0,
  events: [] as { seq: number; event: unknown }[],
  ...over,
})

beforeEach(() => {
  FakeEventSource.instances = []
  // @ts-expect-error test shim
  globalThis.EventSource = FakeEventSource
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('useWorkItemThread terminal handling (no reconnect storm)', () => {
  it('does NOT open an SSE when the snapshot is already terminal (done)', async () => {
    globalThis.fetch = vi.fn(async () => ({
      json: async () => snapshot({ status: 'terminal', done: true, nextSeq: 3 }),
    })) as unknown as typeof fetch

    const { result } = renderHook(() => useWorkItemThread('wi-1'))
    await waitFor(() => expect(result.current.status).toBe('terminal'))
    // The whole trace came from the snapshot; opening a tail to a finished run would only
    // invite the server's immediate close → auto-reconnect storm.
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it('opens an SSE for a live run, then CLOSES it when a terminal status arrives', async () => {
    globalThis.fetch = vi.fn(async () => ({
      json: async () => snapshot({ status: 'active', done: false, nextSeq: 0 }),
    })) as unknown as typeof fetch

    const { result } = renderHook(() => useWorkItemThread('wi-2'))
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    const es = FakeEventSource.instances[0]
    expect(es.closed).toBe(false)

    // Run reaches a terminal state: the server closes the stream; we must close our side too.
    es.emit('status', 'terminal')
    await waitFor(() => expect(result.current.status).toBe('terminal'))
    expect(es.closed).toBe(true)
  })

  it('keeps the SSE open on a NON-terminal status (awaiting_approval) for resume events', async () => {
    globalThis.fetch = vi.fn(async () => ({
      json: async () => snapshot({ status: 'active', done: false, nextSeq: 0 }),
    })) as unknown as typeof fetch

    renderHook(() => useWorkItemThread('wi-3'))
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    const es = FakeEventSource.instances[0]

    es.emit('status', 'awaiting_human')
    expect(es.closed).toBe(false)
  })
})

describe('useWorkItemThread connection state', () => {
  it('flips to reconnecting on an SSE error and back to live on open', async () => {
    globalThis.fetch = vi.fn(async () => ({
      json: async () => snapshot({ status: 'active', done: false, nextSeq: 0 }),
    })) as unknown as typeof fetch

    const { result } = renderHook(() => useWorkItemThread('wi-conn'))
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    expect(result.current.connection).toBe('live')

    const es = FakeEventSource.instances[0]
    es.emit('error', '')
    await waitFor(() => expect(result.current.connection).toBe('reconnecting'))

    es.emit('open', '')
    await waitFor(() => expect(result.current.connection).toBe('live'))
  })
})
