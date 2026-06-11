import { describe, it, expect } from 'vitest'
import { makeActivityLog, type ActivityEntry } from './activity.js'
import { makeEventBus } from './eventBus.js'

describe('activity log', () => {
  it('records entries, caps the ring, and publishes', () => {
    const bus = makeEventBus()
    const seen: ActivityEntry[] = []
    bus.subscribe('activity', (m) => seen.push(m as ActivityEntry))
    const log = makeActivityLog({ bus, limit: 2 })
    const e = (kind: string): ActivityEntry => ({
      ts: 0,
      workflowId: 'wf',
      agentId: 'wf__a',
      workItemId: 'i',
      kind,
      summary: kind,
    })
    log.record(e('queued'))
    log.record(e('running'))
    log.record(e('gate'))
    expect(log.snapshot().map((x) => x.kind)).toEqual(['running', 'gate']) // capped at 2, oldest dropped
    expect(seen).toHaveLength(3)
  })
})
