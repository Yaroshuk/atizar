import { describe, it, expect } from 'vitest'
import { EventType, type BaseEvent } from '@ag-ui/client'
import { GATE_OPENED, gateOpened, readGateOpened, type GateOpenedValue } from './gate.js'

const value: GateOpenedValue = {
  gateKind: 'approval',
  toolName: 'saveDraft',
  toolCallId: 'tc_1',
  proposedArtifact: { threadId: 't_1', body: 'Hello' },
}

describe('gateOpened / readGateOpened', () => {
  it('builds a CUSTOM event named GATE_OPENED carrying the value', () => {
    const ev = gateOpened(value) as unknown as { type: string; name: string; value: unknown }
    expect(ev.type).toBe(EventType.CUSTOM)
    expect(ev.name).toBe(GATE_OPENED)
    expect(ev.value).toEqual(value)
  })

  it('round-trips through readGateOpened', () => {
    expect(readGateOpened(gateOpened(value))).toEqual(value)
  })

  it('returns null for a non-gate event', () => {
    const other = {
      type: EventType.TEXT_MESSAGE_CHUNK,
      role: 'assistant',
      messageId: 'm',
      delta: 'hi',
    }
    expect(readGateOpened(other as unknown as BaseEvent)).toBeNull()
  })

  it('returns null for a CUSTOM event with a different name', () => {
    const ev = { type: EventType.CUSTOM, name: 'SOMETHING_ELSE', value: {} }
    expect(readGateOpened(ev as unknown as BaseEvent)).toBeNull()
  })

  it('returns null when the value fails schema validation', () => {
    const bad = { type: EventType.CUSTOM, name: GATE_OPENED, value: { gateKind: 'approval' } }
    expect(readGateOpened(bad as unknown as BaseEvent)).toBeNull()
  })
})
