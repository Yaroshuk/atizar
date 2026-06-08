import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { CopilotRuntime, createCopilotEndpoint, InMemoryAgentRunner } from '@copilotkit/runtime/v2'
import { instanceId } from '@platform/core'
import { providerRegistry } from './providers.js'
import { buildAgent } from './build-agent.js'
import { workflowServers } from './workflows.js'

// Wiring-time check: a passport must not hand off to an agent absent from its own workflow.
for (const { descriptor } of workflowServers) {
  const ids = new Set(descriptor.agents.map((a) => a.agent.id))
  for (const { agent } of descriptor.agents) {
    for (const target of agent.handoffs ?? []) {
      if (!ids.has(target)) {
        throw new Error(
          `Agent "${agent.id}" in "${descriptor.id}" hands off to unknown agent "${target}"`
        )
      }
    }
  }
}

// Register EVERY workflow × agent under its instance id. The same agent placed in
// two workflows becomes two independently routable runtime agents (stateless re-prime,
// no server session — so they never share state).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const agents: Record<string, any> = {}
for (const { descriptor, bindings } of workflowServers) {
  const byId = new Map(descriptor.agents.map((a) => [a.agent.id, a.agent]))
  for (const b of bindings(descriptor.id)) {
    const def = byId.get(b.agentId)
    if (!def)
      throw new Error(`server binding for unknown agent "${b.agentId}" in "${descriptor.id}"`)
    const key = instanceId(descriptor.id, b.agentId)
    agents[key] = buildAgent(def, b.prompts, providerRegistry, b.allowedTools, key)
  }
}

const runtime = new CopilotRuntime({ agents, runner: new InMemoryAgentRunner() })

const copilot = createCopilotEndpoint({
  runtime,
  basePath: '/api/copilotkit',
  mode: 'single-route',
})
const app = new Hono()
app.route('/', copilot)
serve({ fetch: app.fetch, port: 4000 })
console.log('server on http://localhost:4000')
