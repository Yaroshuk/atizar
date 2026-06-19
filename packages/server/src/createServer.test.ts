import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineAgent, defineProviders, instanceId } from '@atizar/core'
import type { Provider } from '@atizar/core'
import { createServer, resolvePort } from './createServer.js'

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

describe('resolvePort', () => {
  it('defaults to 4000 when PORT is unset', () => {
    expect(resolvePort(undefined)).toBe(4000)
  })

  it('uses a numeric PORT injected by the host', () => {
    expect(resolvePort('8080')).toBe(8080)
  })

  it('falls back to 4000 for a non-numeric PORT', () => {
    expect(resolvePort('not-a-port')).toBe(4000)
  })
})

describe('createServer — static client serving', () => {
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'atizar-static-'))
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>ATIZAR demo</title>')
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log("hi")')
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const build = (staticDir?: string) =>
    createServer({
      workflowServers,
      providerRegistry: registry,
      buildProvider,
      connections: [],
      scopesFor: () => [],
      instanceKeyOf: (agentId) => agentId,
      sourceOf: () => null,
      enabledWorkflows: null,
      start: false,
      staticDir,
    })

  it('serves index.html at the root when staticDir is set', async () => {
    const { app } = await build(dir)
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('ATIZAR demo')
  })

  it('serves a built asset from staticDir', async () => {
    const { app } = await build(dir)
    const res = await app.request('/assets/app.js')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('console.log')
  })

  it('falls back to index.html for an unknown client route (SPA deep-link)', async () => {
    const { app } = await build(dir)
    const res = await app.request('/demo')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('ATIZAR demo')
  })

  it('does not shadow the API when staticDir is set', async () => {
    const { app } = await build(dir)
    const res = await app.request('/api/config')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ demo: expect.any(Boolean) })
  })

  it('mounts no static routes when staticDir is omitted', async () => {
    const { app } = await build()
    const res = await app.request('/')
    expect(res.status).toBe(404)
  })
})
