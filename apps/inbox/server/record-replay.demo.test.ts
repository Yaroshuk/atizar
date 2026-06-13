import { describe, it, expect } from 'vitest'
import { withRecordReplay } from './record-replay.js'
import type { Provider } from '@atizar/core'

// A provider that MUST NOT be called in demo mode (a real claude stand-in). It has a `resume`
// too so withRecordReplay wraps the resume branch (it only wraps resume when the provider has one).
const exploding: Provider = {
  // These generators throw before yielding by design (they assert they're never reached in demo
  // mode), so require-yield does not apply.
  // eslint-disable-next-line require-yield
  async *run() {
    throw new Error('real provider was called in demo mode — should never happen')
  },
  // eslint-disable-next-line require-yield
  async *resume() {
    throw new Error('real provider resume was called in demo mode — should never happen')
  },
}

const demoWrapped = () =>
  withRecordReplay(exploding, {
    key: 'no-such-agent',
    approvalNames: [],
    dir: '/tmp/aiwf-nonexistent-cassettes',
    mode: 'demo',
  })

describe('demo strict replay', () => {
  it('run() throws DemoCassetteMissing instead of calling the real provider on a miss', async () => {
    const iter = demoWrapped().run({ messages: [] } as never)
    await expect(async () => {
      for await (const _e of iter) void _e
    }).rejects.toThrow(/DemoCassetteMissing/)
  })

  it('resume() throws DemoCassetteMissing instead of calling the real provider on a miss', async () => {
    const handle = { runId: 'r1', input: { messages: [] } } as never
    const iter = demoWrapped().resume!(handle, { decision: 'approved' } as never)
    await expect(async () => {
      for await (const _e of iter) void _e
    }).rejects.toThrow(/DemoCassetteMissing/)
  })
})
