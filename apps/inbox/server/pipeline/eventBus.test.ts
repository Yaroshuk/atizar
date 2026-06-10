import { describe, it, expect, vi } from 'vitest'
import { makeEventBus } from './eventBus.js'

describe('EventBus', () => {
  it('delivers a message to subscribers of a topic', () => {
    const bus = makeEventBus()
    const fn = vi.fn()
    bus.subscribe('workitem:1', fn)
    bus.publish('workitem:1', { seq: 0 })
    expect(fn).toHaveBeenCalledWith({ seq: 0 })
  })

  it('isolates topics', () => {
    const bus = makeEventBus()
    const fn = vi.fn()
    bus.subscribe('workitem:1', fn)
    bus.publish('board', { kind: 'status' })
    expect(fn).not.toHaveBeenCalled()
  })

  it('unsubscribe stops delivery', () => {
    const bus = makeEventBus()
    const fn = vi.fn()
    const off = bus.subscribe('board', fn)
    off()
    bus.publish('board', {})
    expect(fn).not.toHaveBeenCalled()
  })
})
