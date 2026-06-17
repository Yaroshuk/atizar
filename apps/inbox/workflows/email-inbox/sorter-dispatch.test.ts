import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// WS1/WS2: lock the sorter's recorded dispatch shape from the COMMITTED demo cassette (synthetic,
// safe to read in CI). The sorter must route ONCE PER DESTINATION GROUP (not per email) and emit
// every route_emails BEFORE renderSort. Re-recording the cassette with a regressed prompt fails this.
const here = dirname(fileURLToPath(import.meta.url))
const cassette = resolve(here, '../../demo-cassettes/email-inbox__sorter.jsonl')

const toolCallSequence = (): string[] =>
  readFileSync(cassette, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { event?: { type?: string; toolCallName?: string } })
    .filter((e) => e.event?.type === 'TOOL_CALL_START' && e.event.toolCallName)
    .map((e) => e.event!.toolCallName!)

describe('sorter recorded dispatch shape (WS1/WS2)', () => {
  it('WS1: routes once per destination group + renders the summary exactly once', () => {
    const seq = toolCallSequence()
    const routes = seq.filter((t) => t === 'route_emails')
    expect(routes.length).toBe(4) // four destination groups, one route each — not one per email
    expect(seq.filter((t) => t === 'renderSort').length).toBe(1)
  })

  it('WS2: every route_emails precedes renderSort (dispatch-before-render)', () => {
    const seq = toolCallSequence()
    const lastRoute = seq.lastIndexOf('route_emails')
    const render = seq.indexOf('renderSort')
    expect(render).toBeGreaterThan(-1)
    expect(lastRoute).toBeLessThan(render)
  })
})
