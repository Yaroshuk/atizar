import { describe, it, expect } from 'vitest'
import { withRecordReplay } from './record-replay.js'
import type { Provider } from '@platform/core'

// A provider that MUST NOT be called in demo mode (a real claude stand-in).
const exploding: Provider = {
  async *run() {
    throw new Error('real provider was called in demo mode — should never happen')
  },
}

describe('demo strict replay', () => {
  it('throws DemoCassetteMissing instead of calling the real provider on a miss', async () => {
    const wrapped = withRecordReplay(exploding, {
      key: 'no-such-agent',
      approvalNames: [],
      dir: '/tmp/aiwf-nonexistent-cassettes',
      mode: 'demo',
    })
    const iter = wrapped.run({ messages: [] } as never)
    await expect(async () => {
      for await (const _e of iter) void _e
    }).rejects.toThrow(/DemoCassetteMissing/)
  })
})
