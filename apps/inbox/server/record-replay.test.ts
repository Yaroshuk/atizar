import { describe, it, expect } from 'vitest'
import { EventType, type BaseEvent } from '@ag-ui/client'
import { encodeLine, parseLine, eventsForStep, dropStep } from './record-replay.js'

const ev = (delta: string): BaseEvent =>
  ({ type: EventType.TEXT_MESSAGE_CHUNK, role: 'assistant', messageId: 'm', delta }) as BaseEvent

describe('cassette line helpers', () => {
  it('encodeLine/parseLine round-trip', () => {
    const line = encodeLine(2, ev('hi'))
    expect(parseLine(line)).toEqual({ step: 2, event: ev('hi') })
  })

  it('parseLine returns null on blank or invalid lines', () => {
    expect(parseLine('')).toBeNull()
    expect(parseLine('   ')).toBeNull()
    expect(parseLine('not json')).toBeNull()
    expect(parseLine('{"event":{}}')).toBeNull() // no numeric step
  })

  it("eventsForStep returns only that step's events in order", () => {
    const text = [encodeLine(0, ev('a')), encodeLine(1, ev('b')), encodeLine(0, ev('c'))].join('\n')
    expect(eventsForStep(text, 0)).toEqual([ev('a'), ev('c')])
    expect(eventsForStep(text, 1)).toEqual([ev('b')])
    expect(eventsForStep(text, 5)).toEqual([])
  })

  it('dropStep keeps every line except the given step', () => {
    const text = [encodeLine(0, ev('a')), encodeLine(1, ev('b'))].join('\n')
    expect(dropStep(text, 0)).toBe(encodeLine(1, ev('b')))
    expect(dropStep(text, 1)).toBe(encodeLine(0, ev('a')))
  })
})
