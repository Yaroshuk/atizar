import { describe, expect, it } from 'vitest'
import { projectScanResult } from './scanResult.js'

const items = [
  { id: 'c-reply', payload: { email: { messageId: 'e1' } } },
  {
    id: 'c-reader',
    payload: {
      emails: [{ messageId: 'e2' }, { messageId: 'e3' }, { messageId: 'e4' }, { messageId: 'e5' }],
    },
  },
]

describe('projectScanResult', () => {
  it('counts NEW per destination from child payloads (reply=1, reader batch=4)', () => {
    const r = projectScanResult(
      [
        { targetAgentId: 'wf__reply', childWorkItemId: 'c-reply', deduped: false },
        { targetAgentId: 'wf__reader', childWorkItemId: 'c-reader', deduped: false },
      ],
      items
    )
    expect(r.new).toEqual({ reply: 1, reader: 4, spam: 0, important: 0 })
    expect(r.alreadyHandled).toEqual({ reply: 0, reader: 0, spam: 0, important: 0 })
    expect(r.read).toBe(5)
  })

  it('a deduped handoff lands in alreadyHandled, not new (re-scan)', () => {
    const r = projectScanResult(
      [{ targetAgentId: 'wf__reader', childWorkItemId: 'c-reader', deduped: true }],
      items
    )
    expect(r.new.reader).toBe(0)
    expect(r.alreadyHandled.reader).toBe(4)
    expect(r.read).toBe(4)
  })

  it('ignores a handoff whose child is not in the current items (aged out of window)', () => {
    const r = projectScanResult(
      [{ targetAgentId: 'wf__reply', childWorkItemId: 'gone', deduped: false }],
      items
    )
    expect(r.read).toBe(0)
  })
})
