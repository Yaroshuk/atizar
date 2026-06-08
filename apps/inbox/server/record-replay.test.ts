import { describe, it, expect } from 'vitest'
import { EventType, type BaseEvent } from '@ag-ui/client'
import { encodeLine, parseLine, eventsForStep, dropStep, scanCassette } from './record-replay.js'

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

describe('scanCassette', () => {
  it('flags an email with its 1-based line number', () => {
    const text = ['clean line', 'contact ivan@acme.ru about it'].join('\n')
    const found = scanCassette(text)
    expect(found).toContainEqual({ line: 2, kind: 'email', snippet: 'ivan@acme.ru' })
  })

  it('flags a token-shaped secret', () => {
    const found = scanCassette('authorization: ghp_ABCDEFGHIJKLMNOP1234')
    expect(found.some((f) => f.kind === 'secret')).toBe(true)
  })

  it('flags a keyword-tagged secret', () => {
    const found = scanCassette('api_key = supersecretvalue123')
    expect(found.some((f) => f.kind === 'secret')).toBe(true)
  })

  it('returns empty on plain prose', () => {
    expect(scanCassette('the customer asked about delivery time')).toEqual([])
  })
})
