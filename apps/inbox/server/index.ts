import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { instanceId, composeInstructions, type HealthCheck } from '@platform/core'
import { providerRegistry } from './providers.js'
import { buildProvider } from './build-agent.js'
import { workflowServers } from './workflows.js'
import {
  db,
  runMigrations,
  startupSweep,
  makePipelineService,
  createPipelineRoutes,
  makeCredentialStore,
  createConnectRoutes,
  type AgentRuntime,
} from '@platform/server'
import { assertAgentClassification } from './agent-checks.js'
import { scopesFor, connectionList } from './connections.js'
import { aggregateHealth, providerHealth } from './health.js'

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

// Health inputs captured alongside runtimes (provider name + binding health checks per instance).
const healthInputs: Record<string, { provider: string; checks: (() => Promise<HealthCheck>)[] }> =
  {}

for (const { descriptor, bindings } of workflowServers) {
  const byId = new Map(descriptor.agents.map((a) => [a.agent.id, a.agent]))
  for (const b of bindings(descriptor.id)) {
    const def = byId.get(b.agentId)
    if (!def)
      throw new Error(`server binding for unknown agent "${b.agentId}" in "${descriptor.id}"`)
    assertAgentClassification(def, { allowedTools: b.allowedTools, effects: b.effects })
    const key = instanceId(descriptor.id, b.agentId)
    // Compose workflow prompt + agent instructions for the Mastra path (config.instructions).
    // The claude-cli PromptStrategy has its own composition point (built in the workflow's
    // server.ts factory); that wiring is deferred to Stage 3.
    const composed = composeInstructions(descriptor.prompt, def.instructions)
    const provider = buildProvider(def, b.prompts, providerRegistry, b.allowedTools, key, composed)
    runtimes[key] = {
      provider,
      renderToolNames: Object.keys(def.renders),
      maxInstances: def.maxInstances,
      effects: b.effects ?? {},
      dispatchToolNames: def.dispatches,
      handoffs: def.handoffs ?? [],
    }
    healthInputs[key] = {
      provider: def.provider,
      checks: (b.health ?? []).map((h) => h.check),
    }
  }
}

// Module-scoped health cache — populated at boot and on every GET /api/health call.
let agentHealthCache: Record<string, HealthCheck> = {}

async function computeAgentHealth(): Promise<Record<string, HealthCheck>> {
  const entries = await Promise.all(
    Object.entries(healthInputs).map(async ([key, { provider, checks }]) => {
      const provCheck = providerHealth(provider)
      const bindingChecks = await Promise.all(
        checks.map((check) =>
          check().catch(
            (e): HealthCheck => ({
              ok: false,
              error: String(e),
              hint: 'binding health check threw an unexpected error',
            })
          )
        )
      )
      return [key, aggregateHealth([provCheck, ...bindingChecks])] as const
    })
  )
  return Object.fromEntries(entries)
}

async function refreshHealth(): Promise<Record<string, HealthCheck>> {
  agentHealthCache = await computeAgentHealth()
  return agentHealthCache
}

const pipeline = makePipelineService({
  db,
  resolveAgent: (id) => runtimes[id],
  descriptors: workflowServers.map((w) => w.descriptor),
  getAgentHealth: () => agentHealthCache,
  refreshHealth,
})

// Server-authoritative pipeline spine — the ONLY transport (CopilotKit dropped at step 6):
// board + per-WorkItem trace/SSE + dispatch/deliver/resolve/cancel, all on Postgres.
const app = new Hono()
app.route('/', createPipelineRoutes(pipeline))

// OAuth connect flow + connection-status reporting (auth sub-stage 3). The app supplies its
// integrations' scopes and the (integration, connection, provider) tuples to report; the routes
// themselves stay integration-agnostic.
app.route(
  '/',
  createConnectRoutes({ store: makeCredentialStore(db), scopesFor, list: connectionList })
)

// Boot: apply migrations (so a fresh clone + `yarn dev` just works) and reconcile any rows
// left dangling by a prior process (the zombie/stale-state public-embarrassment guard).
async function boot(): Promise<void> {
  await runMigrations()
  await startupSweep(db, (item) => pipeline.reenqueue(item))
  serve({ fetch: app.fetch, port: 4000 })
  console.log('server on http://localhost:4000')
  // Credential-health sweep (F3 — never throws; logs a one-line summary).
  try {
    const health = await refreshHealth()
    const values = Object.values(health)
    const okCount = values.filter((h) => h.ok).length
    const failCount = values.length - okCount
    const parts = [`${okCount} ok`]
    if (failCount > 0) parts.push(`${failCount} missing-creds`)
    console.log(`health: ${parts.join(', ')}`)
  } catch (e) {
    console.error('[health] boot sweep failed (non-fatal):', e)
  }
}

void boot().catch((err) => {
  console.error('[server] boot failed:', err)
  process.exit(1)
})
