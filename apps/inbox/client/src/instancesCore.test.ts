import { describe, it, expect } from 'vitest'
import { liveCount, canSpawn, liveDuplicate } from './instancesCore'
import type { Status } from './status'

const inst = (runtimeKey: string, status: Status) => ({ runtimeKey, status })

describe('instancesCore', () => {
  it('liveCount counts non-done instances of a runtimeKey', () => {
    const all = [inst('a', 'running'), inst('a', 'done'), inst('b', 'running')]
    // done instances are torn down, but guard against a transient done not yet removed:
    expect(liveCount(all, 'a')).toBe(1)
    expect(liveCount(all, 'b')).toBe(1)
  })
  it('canSpawn is true below the cap', () => {
    expect(canSpawn([inst('a', 'running')], 'a', 2)).toBe(true)
  })
  it('canSpawn is false at the cap', () => {
    expect(canSpawn([inst('a', 'running'), inst('a', 'awaiting_approval')], 'a', 2)).toBe(false)
  })
})

describe('liveDuplicate', () => {
  const dup = (runtimeKey: string, deliveryKey: string, status: Status, localId: string) => ({
    runtimeKey,
    deliveryKey,
    status,
    localId,
  })
  it('returns the localId of a live instance with the same runtimeKey + deliveryKey', () => {
    const all = [dup('a__reply', 'thread:1', 'awaiting_approval', 'a__reply#1')]
    expect(liveDuplicate(all, 'a__reply', 'thread:1')).toBe('a__reply#1')
  })
  it('ignores a done instance (it is being torn down)', () => {
    const all = [dup('a__reply', 'thread:1', 'done', 'a__reply#1')]
    expect(liveDuplicate(all, 'a__reply', 'thread:1')).toBeUndefined()
  })
  it('does not match a different runtimeKey or a different deliveryKey', () => {
    const all = [dup('a__reply', 'thread:1', 'running', 'a__reply#1')]
    expect(liveDuplicate(all, 'b__reply', 'thread:1')).toBeUndefined()
    expect(liveDuplicate(all, 'a__reply', 'thread:2')).toBeUndefined()
  })
})
