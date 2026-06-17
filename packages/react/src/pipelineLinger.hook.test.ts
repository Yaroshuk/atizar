import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Import the hook — will fail (RED) until useLingerSet is implemented.
import { useLingerSet } from './pipelineLinger.js'

const S = (...ids: string[]) => new Set(ids)
const arr = (s: ReadonlySet<string>) => [...s].sort()

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useLingerSet — set membership across renders and fake-timer advances', () => {
  it('initially present ids are in lingering and not leaving', () => {
    const { result } = renderHook(() => useLingerSet(S('a', 'b'), 300))
    expect(arr(result.current.lingering)).toEqual(['a', 'b'])
    expect(result.current.isLeaving('a')).toBe(false)
    expect(result.current.isLeaving('b')).toBe(false)
  })

  it('a dropping id immediately appears in lingering as leaving (before the timer fires)', () => {
    const { result, rerender } = renderHook(({ present }) => useLingerSet(present, 300), {
      initialProps: { present: S('a', 'b') },
    })
    // Drop 'b' from the present set.
    rerender({ present: S('a') })
    expect(arr(result.current.lingering)).toEqual(['a', 'b'])
    expect(result.current.isLeaving('b')).toBe(true)
    expect(result.current.isLeaving('a')).toBe(false)
  })

  it('a leaving id is removed from lingering after the linger timer fires', () => {
    const { result, rerender } = renderHook(({ present }) => useLingerSet(present, 300), {
      initialProps: { present: S('a', 'b') },
    })
    rerender({ present: S('a') })
    // Before timer: 'b' is still lingering.
    expect(arr(result.current.lingering)).toEqual(['a', 'b'])
    // Advance past the linger window — the timer callback removes 'b' and re-renders.
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(arr(result.current.lingering)).toEqual(['a'])
    expect(result.current.isLeaving('b')).toBe(false)
  })

  it('a reappearing id is un-scheduled and leaves the leaving set immediately', () => {
    const { result, rerender } = renderHook(({ present }) => useLingerSet(present, 300), {
      initialProps: { present: S('a', 'b') },
    })
    // Drop 'b'.
    rerender({ present: S('a') })
    expect(result.current.isLeaving('b')).toBe(true)
    // 'b' comes back before the timer fires.
    rerender({ present: S('a', 'b') })
    expect(result.current.isLeaving('b')).toBe(false)
    expect(arr(result.current.lingering)).toEqual(['a', 'b'])
    // Advancing the timer should not affect anything (the removal was cancelled).
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(arr(result.current.lingering)).toEqual(['a', 'b'])
  })

  it('lingering always includes both present and leaving ids (superset)', () => {
    const { result, rerender } = renderHook(({ present }) => useLingerSet(present, 500), {
      initialProps: { present: S('a', 'b', 'c') },
    })
    rerender({ present: S('a') })
    // 'b' and 'c' are leaving — all three must remain in lingering.
    expect(arr(result.current.lingering)).toEqual(['a', 'b', 'c'])
    // After partial advance (250 ms), still there.
    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(arr(result.current.lingering)).toEqual(['a', 'b', 'c'])
    // Full advance — both drop.
    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(arr(result.current.lingering)).toEqual(['a'])
  })
})
