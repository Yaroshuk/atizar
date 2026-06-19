import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// WS1/WS2: lock the sorter's recorded dispatch shape from the COMMITTED demo cassette (synthetic,
// safe to read in CI). Batch destinations (reader/spam/important) route ONCE PER GROUP (not per
// email); reply is per-email (its tool takes a single `email`), so the demo's two reply emails are
// two reply routes. Every route_emails precedes renderSort. A regressed re-record fails this.
const here = dirname(fileURLToPath(import.meta.url))
const cassette = resolve(here, '../../demo-cassettes/email-inbox__sorter.jsonl')

type Started = { name: string; id: string }

const starts = (): Started[] =>
  readFileSync(cassette, 'utf8')
    .trim()
    .split('\n')
    .map(
      (l) =>
        JSON.parse(l) as {
          event?: { type?: string; toolCallName?: string; toolCallId?: string }
        }
    )
    .filter((e) => e.event?.type === 'TOOL_CALL_START' && e.event.toolCallName)
    .map((e) => ({ name: e.event!.toolCallName!, id: e.event!.toolCallId! }))

const toolCallSequence = (): string[] => starts().map((s) => s.name)

describe('sorter recorded dispatch shape (WS1/WS2)', () => {
  it('WS1: batch groups route once each, reply per-email, summary exactly once', () => {
    const all = starts()
    const routeIds = all.filter((s) => s.name === 'route_emails').map((s) => s.id)
    // batch destinations collapse to one route each
    for (const dest of ['reader', 'spam', 'important']) {
      expect(routeIds.filter((id) => id.includes(`route_${dest}`)).length).toBe(1)
    }
    // reply is per-email — the demo ships two reply emails (two reply instances)
    expect(routeIds.filter((id) => id.includes('route_reply')).length).toBe(2)
    expect(routeIds.length).toBe(5)
    expect(toolCallSequence().filter((t) => t === 'renderSort').length).toBe(1)
  })

  it('WS2: every route_emails precedes renderSort (dispatch-before-render)', () => {
    const seq = toolCallSequence()
    const lastRoute = seq.lastIndexOf('route_emails')
    const render = seq.indexOf('renderSort')
    expect(render).toBeGreaterThan(-1)
    expect(lastRoute).toBeLessThan(render)
  })
})
