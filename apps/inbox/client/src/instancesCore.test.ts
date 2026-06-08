import { describe, it, expect } from 'vitest'
import { liveCount, canSpawn } from './instancesCore'
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
