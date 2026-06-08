import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { EventType, type BaseEvent } from '@ag-ui/client'
import {
  encodeLine,
  parseLine,
  eventsForStep,
  dropStep,
  scanCassette,
  CassetteStore,
} from './record-replay.js'

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

  it('flags an Anthropic-style key with hyphens (standalone)', () => {
    const found = scanCassette('key sk-ant-api03-ABCDEFGHIJKLMNOPQRST1234')
    expect(found.some((f) => f.kind === 'secret')).toBe(true)
  })

  it('flags an Authorization: Bearer header', () => {
    const found = scanCassette('Authorization: Bearer eyJhbGciOiJIUzI1Ni1234')
    expect(found.some((f) => f.kind === 'secret')).toBe(true)
  })

  it('flags a real-looking phone number', () => {
    const found = scanCassette('call +1 (800) 555-1234 today')
    expect(found.some((f) => f.kind === 'phone')).toBe(true)
  })

  it('does NOT flag an ISO date as a phone number', () => {
    const found = scanCassette('{"createdAt":"2024-01-15"}')
    expect(found.some((f) => f.kind === 'phone')).toBe(false)
  })
})

describe('CassetteStore', () => {
  it('readStep returns null when the file does not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cassette-'))
    const store = new CassetteStore(dir, 'wf__agent')
    expect(await store.readStep(0)).toBeNull()
  })

  it("writeStep then readStep round-trips that step's events", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cassette-'))
    const store = new CassetteStore(dir, 'wf__agent')
    await store.writeStep(0, [ev('a'), ev('b')])
    expect(await store.readStep(0)).toEqual([ev('a'), ev('b')])
    expect(await store.readStep(1)).toBeNull()
  })

  it('writeStep preserves other steps in the same file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cassette-'))
    const store = new CassetteStore(dir, 'wf__agent')
    await store.writeStep(0, [ev('a')])
    await store.writeStep(1, [ev('b')])
    expect(await store.readStep(0)).toEqual([ev('a')])
    expect(await store.readStep(1)).toEqual([ev('b')])
  })

  it('writeStep replaces (overwrites) an existing step', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cassette-'))
    const store = new CassetteStore(dir, 'wf__agent')
    await store.writeStep(0, [ev('old')])
    await store.writeStep(0, [ev('new')])
    expect(await store.readStep(0)).toEqual([ev('new')])
  })
})
