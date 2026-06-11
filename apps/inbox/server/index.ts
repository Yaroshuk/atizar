import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { instanceId, composeInstructions } from '@platform/core'
import { providerRegistry } from './providers.js'
import { buildProvider } from './build-agent.js'
import { workflowServers } from './workflows.js'
import {
  db,
  runMigrations,
  startupSweep,
  makePipelineService,
  createPipelineRoutes,
  type AgentRuntime,
} from '@platform/server'
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
// no server session — so they never share state). The server-authoritative spine
// (RunObserver) consumes these wrapped providers; each runtime also carries the agent's
// render-tool names + concurrency cap + server-executed effects.
const runtimes: Record<string, AgentRuntime> = {}
for (const { descriptor, bindings } of workflowServers) {
  const byId = new Map(descriptor.agents.map((a) => [a.agent.id, a.agent]))
  for (const b of bindings(descriptor.id)) {
    const def = byId.get(b.agentId)
    if (!def)
      throw new Error(`server binding for unknown agent "${b.agentId}" in "${descriptor.id}"`)
    assertAgentClassification(def, { allowedTools: b.allowedTools, effects: b.effects })
    const key = instanceId(descriptor.id, b.agentId)
    // Compose the workflow-level prompt (if declared) with the agent's own instructions
    // for the Mastra path (config.instructions). The claude-cli path's prompt-strategy
    // composition is the workflow server.ts's job (it has descriptor.prompt available via
    // the aggregator) and is wired in Stage 3 — Stage 2 ships the mechanism + Mastra threading.
    const composed = composeInstructions(descriptor.prompt, def.instructions)
    const provider = buildProvider(def, b.prompts, providerRegistry, b.allowedTools, key, composed)
    runtimes[key] = {
      provider,
      renderToolNames: Object.keys(def.renders),
      maxInstances: def.maxInstances,
      effects: b.effects ?? {},
    }
  }
}

const pipeline = makePipelineService({
  db,
  resolveAgent: (id) => runtimes[id],
  descriptors: workflowServers.map((w) => w.descriptor),
})

// Server-authoritative pipeline spine — the ONLY transport (CopilotKit dropped at step 6):
// board + per-WorkItem trace/SSE + dispatch/deliver/resolve/cancel, all on Postgres.
const app = new Hono()
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
