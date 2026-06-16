import { describe, it, expect } from 'vitest'
import { defineAgent, defineProviders, instanceId } from '@atizar/core'
import type { Provider } from '@atizar/core'
import { createServer } from './createServer.js'

const baseProvider: Provider = { async *run() {} }
const registry = defineProviders({ mock: () => baseProvider })

const agent = defineAgent({
  id: 'sorter',
  name: 'SORTER',
  provider: 'mock',
  instructions: 'x',
  tools: ['renderSort'],
  approvals: [],
  renders: { renderSort: 'SortCard' },
  readonly: ['renderSort'],
})

const descriptor = {
  id: 'email-inbox',
  label: 'Email',
  iconName: 'inbox',
  agents: [{ agent, role: 'input' as const }],
  entryAgentId: 'sorter',
  inputs: [],
}

const workflowServers = [
  {
    descriptor,
    bindings: () => [
      {
        agentId: 'sorter',
        allowedTools: ['renderSort'],
        prompts: { buildFirst: () => 'p', buildResume: () => null },
      },
    ],
  },
]

// The app's buildProvider shape (resolve the factory + construct) — inlined for the test.
const buildProvider: Parameters<typeof createServer>[0]['buildProvider'] = (
  def,
  prompts,
  reg,
  allowed,
  key
) =>
  reg.resolve(def.provider)({
    approvalNames: def.approvals,
    surfaceTools: def.tools,
    allowedTools: allowed,
    prompts,
    instructions: def.instructions,
    agentId: key,
  })

describe('createServer (start: false)', () => {
  it('registers every enabled workflow × agent under its instance id', async () => {
    const built = await createServer({
      workflowServers,
      providerRegistry: registry,
      buildProvider,
      connections: [],
      scopesFor: () => [],
      instanceKeyOf: (agentId) => agentId,
      sourceOf: () => null,
      enabledWorkflows: null,
      start: false,
    })
    expect(Object.keys(built.runtimes)).toEqual([instanceId('email-inbox', 'sorter')])
    expect(built.runtimes[instanceId('email-inbox', 'sorter')].renderToolNames).toEqual([
      'renderSort',
    ])
  })

  it('the demo filter narrows to the enabled workflow ids', async () => {
    const built = await createServer({
      workflowServers,
      providerRegistry: registry,
      buildProvider,
      connections: [],
      scopesFor: () => [],
      instanceKeyOf: (agentId) => agentId,
      sourceOf: () => null,
      enabledWorkflows: ['nonexistent'],
      start: false,
    })
    expect(Object.keys(built.runtimes)).toEqual([])
  })
})
