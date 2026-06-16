import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import {
  instanceId,
  composeInstructions,
  aggregateHealth,
  type AgentDefinition,
  type ProviderRegistry,
  type PromptStrategy,
  type Provider,
  type WorkflowDescriptor,
  type EffectFn,
  type HealthCheck,
} from '@atizar/core'
import { db } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { startupSweep } from './sweep.js'
import { makePipelineService } from './pipelineService.js'
import { createPipelineRoutes } from './routes.js'
import { makeCredentialStore } from './credentialStore.js'
import { createConnectRoutes, type ConnectionDescriptor } from './connectRoutes.js'
import { createAuthMiddleware } from './auth.js'
import { atizarEnv, isDemo } from './env.js'
import { assertAgentClassification } from './agentChecks.js'
import { providerHealth } from './providerHealth.js'
import type { AgentRuntime } from './runObserver.js'

// Structural views of the app's workflow-server registry — @atizar/server stays userland-free
// (no import of the concrete `workflowServers`). The app passes objects matching these shapes.
export interface ServerBindingLike {
  agentId: string
  allowedTools: string[]
  prompts: PromptStrategy
  effects?: Record<string, EffectFn>
  health?: { check: () => Promise<HealthCheck> }[]
}
export interface WorkflowServerLike {
  descriptor: WorkflowDescriptor
  bindings: (workflowId: string) => ServerBindingLike[]
}

// The app injects how a provider is built (so the dev record/replay wrap stays app-side — move 8).
export type BuildProviderFn = (
  def: AgentDefinition,
  prompts: PromptStrategy,
  registry: ProviderRegistry,
  allowedTools: readonly string[],
  instanceKey: string,
  composedInstructions?: string
) => Provider

export interface CreateServerArgs {
  workflowServers: WorkflowServerLike[]
  providerRegistry: ProviderRegistry
  buildProvider: BuildProviderFn
  connections: ConnectionDescriptor[]
  scopesFor: (integration: string) => string[]
  // null = all workflows; an array = the demo filter (only these ids enabled).
  enabledWorkflows: string[] | null
  // The app's instance-key policy (spec 2026-06-16): given a runtime agent id (wf__agent) and the
  // dispatch payload, return the correlation key. Same key → same instance. The framework declares
  // this SEAM but never the policy — the body (reply→sender, others→constant) lives in the app.
  instanceKeyOf: (agentId: string, payload: Record<string, unknown>) => string
  // When false, assemble + register but do NOT serve/migrate/sweep (the unit-test path).
  start?: boolean
}

export interface BuiltServer {
  app: Hono
  runtimes: Record<string, AgentRuntime>
  refreshHealth: () => Promise<Record<string, HealthCheck>>
}

export async function createServer(args: CreateServerArgs): Promise<BuiltServer> {
  const { workflowServers, providerRegistry, buildProvider, connections, scopesFor } = args
  const activeWorkflowServers = args.enabledWorkflows
    ? workflowServers.filter((w) => args.enabledWorkflows!.includes(w.descriptor.id))
    : workflowServers

  // Wiring-time check: a passport must not hand off to an agent absent from its own workflow.
  for (const { descriptor } of activeWorkflowServers) {
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

  const runtimes: Record<string, AgentRuntime> = {}
  const healthInputs: Record<string, { provider: string; checks: (() => Promise<HealthCheck>)[] }> =
    {}

  for (const { descriptor, bindings } of activeWorkflowServers) {
    const byId = new Map(descriptor.agents.map((a) => [a.agent.id, a.agent]))
    for (const b of bindings(descriptor.id)) {
      const def = byId.get(b.agentId)
      if (!def)
        throw new Error(`server binding for unknown agent "${b.agentId}" in "${descriptor.id}"`)
      assertAgentClassification(def, { allowedTools: b.allowedTools, effects: b.effects })
      const key = instanceId(descriptor.id, b.agentId)
      const composed = composeInstructions(descriptor.prompt, def.instructions)
      const provider = buildProvider(
        def,
        b.prompts,
        providerRegistry,
        b.allowedTools,
        key,
        composed
      )
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

  let agentHealthCache: Record<string, HealthCheck> = {}

  async function computeAgentHealth(): Promise<Record<string, HealthCheck>> {
    if (isDemo()) {
      return Object.fromEntries(Object.keys(healthInputs).map((key) => [key, { ok: true }]))
    }
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
    descriptors: activeWorkflowServers.map((w) => w.descriptor),
    getAgentHealth: () => agentHealthCache,
    refreshHealth,
    instanceKeyOf: args.instanceKeyOf,
  })

  const app = new Hono()
  const authToken = atizarEnv.authToken()
  app.use('*', createAuthMiddleware({ token: authToken, demo: isDemo() }))
  app.get('/api/config', (c) =>
    c.json({ demo: isDemo(), workflows: activeWorkflowServers.map((w) => w.descriptor.id) })
  )
  app.route('/', createPipelineRoutes(pipeline))
  app.route(
    '/',
    createConnectRoutes({ store: makeCredentialStore(db), scopesFor, list: connections })
  )

  if (args.start) {
    await runMigrations()
    await startupSweep(db, (item) => pipeline.reenqueue(item))
    serve({ fetch: app.fetch, port: 4000 })
    console.log('server on http://localhost:4000')
    if (!isDemo() && !authToken) {
      console.warn('[auth] disabled — set ATIZAR_AUTH_TOKEN to require a token on mutations')
    }
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

  return { app, runtimes, refreshHealth }
}
