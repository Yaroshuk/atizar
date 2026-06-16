import { instanceId, composeInstructions, lifecycle, type Phase, type Outcome } from '@atizar/core'
import { db, makePipelineService, type AgentRuntime } from '@atizar/server'
import { providerRegistry } from '../server/providers.js'
import { buildProvider } from '../server/build-agent.js'
import { workflowServers } from '../server/workflows.js'

// The eval facts speak the legacy status word so the golden scenarios stay readable. Map the
// row's (phase, outcome) to that word: a terminal item reports its outcome (done→'finished',
// reset/superseded→'closed', else the outcome itself); a live item reports its phase word.
function legacyStatus(phase: Phase, outcome: Outcome): string {
  if (phase !== 'terminal') return phase === 'awaiting_human' ? 'awaiting_approval' : phase
  if (outcome === 'done') return 'finished'
  if (outcome === 'reset' || outcome === 'superseded') return 'closed'
  return outcome // stopped | rejected | error
}

export type GateFacts = {
  workItemId: string
  kind: string
  toolName: string
  formKeys: string[]
}

export type EffectCall = {
  agentId: string
  toolName: string
  form: Record<string, unknown>
}

export type ItemFacts = {
  id: string
  agentId: string
  parentId: string | null
  status: string
  resolution: string | null
  card: Record<string, unknown> | null
}

export type RunFacts = {
  items: ItemFacts[]
  gates: GateFacts[]
  effects: EffectCall[]
}

export type GoldenScenario = {
  name: string
  workflow: string
  entryAgent: string
  payload: Record<string, unknown>
  gateScript?: (gate: GateFacts) => {
    decision: 'approved' | 'rejected'
    form?: Record<string, unknown>
    comment?: string
  }
  expect: {
    gates?: { toolName: string; kind: string; formKeys: string[] }[]
    effects?: { toolName: string }[]
    finalStatuses?: Record<string, string>
    resolutions?: Record<string, string>
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function buildEvalService(): {
  service: ReturnType<typeof makePipelineService>
  effectCalls: EffectCall[]
} {
  const effectCalls: EffectCall[] = []
  const runtimes: Record<string, AgentRuntime> = {}

  for (const { descriptor, bindings } of workflowServers) {
    const byId = new Map(descriptor.agents.map((a) => [a.agent.id, a.agent]))
    for (const b of bindings(descriptor.id)) {
      const def = byId.get(b.agentId)
      if (!def) throw new Error(`eval: binding for unknown agent "${b.agentId}"`)
      const key = instanceId(descriptor.id, b.agentId)
      const composed = composeInstructions(descriptor.prompt ?? '', def.instructions)
      const provider = buildProvider(
        def,
        b.prompts,
        providerRegistry,
        b.allowedTools,
        key,
        composed
      )

      const fakeEffects: AgentRuntime['effects'] = {}
      for (const name of Object.keys(b.effects ?? {})) {
        fakeEffects[name] = async (form: Record<string, unknown>) => {
          effectCalls.push({ agentId: key, toolName: name, form })
          return { ok: true, draftId: `eval-${name}` }
        }
      }

      runtimes[key] = {
        provider,
        renderToolNames: Object.keys(def.renders),
        maxInstances: def.maxInstances,
        effects: fakeEffects,
        dispatchToolNames: def.dispatches,
        handoffs: def.handoffs ?? [],
      }
    }
  }

  const service = makePipelineService({
    db,
    resolveAgent: (id) => runtimes[id],
    descriptors: workflowServers.map((w) => w.descriptor),
    instanceKeyOf: (agentId) => agentId,
    sourceOf: () => null,
  })
  return { service, effectCalls }
}

export async function runGolden(scenario: GoldenScenario): Promise<RunFacts> {
  const { service, effectCalls } = buildEvalService()
  const gatesSeen: GateFacts[] = []

  await service.dispatch({
    workflowId: scenario.workflow,
    agentId: instanceId(scenario.workflow, scenario.entryAgent),
    origin: 'human',
    payload: scenario.payload,
    source: null,
    parentId: null,
  })

  const startedAt = Date.now()
  for (;;) {
    if (Date.now() - startedAt > 45_000) throw new Error(`eval: "${scenario.name}" did not quiesce`)
    const { items, gates } = await service.getBoard()

    if (gates.length > 0) {
      const gate = gates[0]
      const facts: GateFacts = {
        workItemId: gate.workItemId,
        kind: gate.kind,
        toolName: gate.toolName,
        formKeys: Object.keys(
          (gate.form ?? gate.proposedArtifact ?? {}) as Record<string, unknown>
        ),
      }
      gatesSeen.push(facts)
      const choice = scenario.gateScript?.(facts) ?? { decision: 'approved' as const }
      const res = await service.resolveGate(gate.id, {
        gateId: gate.id,
        formRev: gate.formRev,
        decision: choice.decision,
        form: choice.form,
        comment: choice.comment,
      })
      if (!res.ok && res.status !== 404) {
        throw new Error(`eval: resolveGate failed (${res.status}) ${res.error}`)
      }
      continue
    }

    const active = items.filter((i) => lifecycle(i.phase, i.outcome, false, false).isLive)
    if (active.length === 0) {
      return {
        items: items.map((i) => ({
          id: i.id,
          agentId: i.agentId,
          parentId: i.parentId,
          status: legacyStatus(i.phase, i.outcome),
          resolution: i.outcome,
          card: (i.card as Record<string, unknown> | null) ?? null,
        })),
        gates: gatesSeen,
        effects: effectCalls,
      }
    }
    await sleep(15)
  }
}
