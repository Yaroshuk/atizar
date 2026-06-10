import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { CopilotRuntime, createCopilotEndpoint, InMemoryAgentRunner } from '@copilotkit/runtime/v2'
import { instanceId } from '@platform/core'
import { providerRegistry } from './providers.js'
import { buildAgent, buildProvider } from './build-agent.js'
import { workflowServers } from './workflows.js'
import { db } from './pipeline/db/client.js'
import { runMigrations } from './pipeline/db/migrate.js'
import { startupSweep } from './pipeline/sweep.js'
import { makePipelineService } from './pipeline/pipelineService.js'
import { createPipelineRoutes } from './pipeline/routes.js'
import type { AgentRuntime } from './pipeline/runObserver.js'
import { assertAgentClassification } from './agent-checks.js'

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
// The server-authoritative spine consumes the SAME wrapped providers as the CopilotKit
// agents (one code path), plus each agent's render-tool names + concurrency cap.
const runtimes: Record<string, AgentRuntime> = {}
for (const { descriptor, bindings } of workflowServers) {
  const byId = new Map(descriptor.agents.map((a) => [a.agent.id, a.agent]))
  for (const b of bindings(descriptor.id)) {
    const def = byId.get(b.agentId)
    if (!def)
      throw new Error(`server binding for unknown agent "${b.agentId}" in "${descriptor.id}"`)
    assertAgentClassification(def, { allowedTools: b.allowedTools, effects: b.effects })
    const key = instanceId(descriptor.id, b.agentId)
    const provider = buildProvider(def, b.prompts, providerRegistry, b.allowedTools, key)
    agents[key] = buildAgent(def, b.prompts, providerRegistry, b.allowedTools, key)
    runtimes[key] = {
      provider,
      renderToolNames: Object.keys(def.renders),
      maxInstances: def.maxInstances,
      effects: b.effects ?? {},
    }
  }
}

const pipeline = makePipelineService({ db, resolveAgent: (id) => runtimes[id] })

const runtime = new CopilotRuntime({ agents, runner: new InMemoryAgentRunner() })

const copilot = createCopilotEndpoint({
  runtime,
  basePath: '/api/copilotkit',
  mode: 'single-route',
})
const app = new Hono()
app.route('/', copilot)
// Server-authoritative pipeline spine (step 3): board + per-WorkItem trace/SSE on Postgres.
// The CopilotKit transport above stays the live dev surface until step 6.
app.route('/', createPipelineRoutes(pipeline))

// Boot: apply migrations (so a fresh clone + `yarn dev` just works) and reconcile any rows
// left dangling by a prior process (the zombie/stale-state public-embarrassment guard).
async function boot(): Promise<void> {
  await runMigrations()
  await startupSweep(db, (item) => pipeline.reenqueue(item))
  serve({ fetch: app.fetch, port: 4000 })
  console.log('server on http://localhost:4000')
}

void boot().catch((err) => {
  console.error('[server] boot failed:', err)
  process.exit(1)
})
