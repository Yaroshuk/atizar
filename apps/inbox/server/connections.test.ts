import { describe, expect, test } from 'vitest'
import { deriveConnectionList } from './connections.js'
import type { WorkflowDescriptor } from '@atizar/core'

const wf = (id: string, connections?: WorkflowDescriptor['connections']): WorkflowDescriptor => ({
  id,
  label: id,
  iconName: 'inbox',
  agents: [],
  entryAgentId: 'x',
  inputs: [],
  connections,
})
describe('deriveConnectionList', () => {
  test('unions + defaults connection to "default"', () => {
    expect(
      deriveConnectionList([
        wf('a', [{ integration: 'gmail', provider: 'google' }]),
        wf('b', [{ integration: 'gmail', provider: 'google' }]),
      ])
    ).toEqual([{ integration: 'gmail', connection: 'default', provider: 'google' }])
  })
  test('dedupes by (integration, connection), keeps distinct connections', () => {
    expect(
      deriveConnectionList([
        wf('a', [{ integration: 'gmail', provider: 'google' }]),
        wf('b', [{ integration: 'gmail', connection: 'work', provider: 'google' }]),
      ])
    ).toEqual([
      { integration: 'gmail', connection: 'default', provider: 'google' },
      { integration: 'gmail', connection: 'work', provider: 'google' },
    ])
  })
  test('no connections contribute nothing', () => {
    expect(deriveConnectionList([wf('a'), wf('b', [])])).toEqual([])
  })
})
