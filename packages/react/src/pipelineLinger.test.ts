import { describe, expect, it } from 'vitest'
import { diffLeaving } from './pipelineLinger.js'

const S = (...ids: string[]) => new Set(ids)
const arr = (s: ReadonlySet<string>) => [...s].sort()

describe('diffLeaving', () => {
  it('first render: everything present, nothing leaving', () => {
    const r = diffLeaving(S(), S(), S('a', 'b'))
    expect(arr(r.present)).toEqual(['a', 'b'])
    expect(arr(r.leaving)).toEqual([])
  })

  it('an id that drops out of current starts leaving (still tracked)', () => {
    const r = diffLeaving(S('a', 'b'), S(), S('a'))
    expect(arr(r.present)).toEqual(['a'])
    expect(arr(r.leaving)).toEqual(['b'])
  })

  it('an already-leaving id that is still absent stays leaving', () => {
    const r = diffLeaving(S('a'), S('b'), S('a'))
    expect(arr(r.leaving)).toEqual(['b'])
  })

  it('the hook having cleared a timed-out id (not in prevLeaving) drops it', () => {
    // hook removed 'b' from prevLeaving before calling → it must NOT come back
    const r = diffLeaving(S('a'), S(), S('a'))
    expect(arr(r.leaving)).toEqual([])
    expect(arr(r.present)).toEqual(['a'])
  })

  it('a reappearing id is present again and removed from leaving (re-run un-fades)', () => {
    const r = diffLeaving(S('a'), S('b'), S('a', 'b'))
    expect(arr(r.present)).toEqual(['a', 'b'])
    expect(arr(r.leaving)).toEqual([])
  })

  it('does not mark an id leaving twice / never both present and leaving', () => {
    const r = diffLeaving(S('a', 'b'), S('c'), S('a'))
    // b newly leaves, c still leaving, a stays present — disjoint sets
    expect(arr(r.present)).toEqual(['a'])
    expect(arr(r.leaving)).toEqual(['b', 'c'])
    expect([...r.present].some((x) => r.leaving.has(x))).toBe(false)
  })
})
