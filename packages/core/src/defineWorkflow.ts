// packages/core/src/defineWorkflow.ts
import { z } from 'zod'
import type { AgentDefinition } from './defineAgent.js'

export type AgentRole = 'input' | 'worker'

export type WorkflowAgent = {
  agent: AgentDefinition
  role: AgentRole
}

// Published contract entry. Public face is { name, schema }; agentId is the PRIVATE
// binding to the input agent that receives a cross-workflow parcel of this shape.
export type WorkflowInput = {
  name: string
  schema: z.ZodTypeAny
  agentId: string
}

// A connection (OAuth credential) a workflow requires. `connection` defaults to 'default' at the
// point of use (the server union). `provider` is required so the OAuth bounce knows the endpoint.
// Names live here in core; the concrete OAuth/provider wiring stays in the server layer.
export type WorkflowConnection = {
  integration: string
  connection?: string
  provider: string
}

export type WorkflowDescriptor = {
  id: string
  label: string
  iconName: string
  agents: WorkflowAgent[]
  entryAgentId: string
  inputs: WorkflowInput[]
  // Optional shared context prepended to every agent's instructions in this workflow (tone,
  // rules). Threaded through at binding time via composeInstructions(). A workflow that
  // declares no prompt is entirely unaffected.
  prompt?: string
  // Integrations (OAuth connections) this workflow needs. The server unions these across all
  // loaded workflows to derive the live connection list — a stale/extra chip becomes impossible.
  connections?: WorkflowConnection[]
  // Re-run policy when a human STARTs an input agent that already has a finished scan root
  // (config-as-data, I7). Default 'refresh': the prior finished root is superseded
  // (status 'closed', resolution 'superseded') and the new scan becomes current; per-item
  // work items the scan surfaced stay durable. 'history' (reserved, NOT wired in the beta):
  // no auto-supersede — every finished scan is kept and the human chooses which is current.
  // The 'history' branch point lives in pipelineService.dispatch(); see its comment there.
  rerun?: 'refresh' | 'history'
  // Clear-on-START policy (config-as-data, I7). Default off. When true, a human START of this
  // workflow's input agent first RESETs the workflow's TERMINAL items — they move to 'closed'
  // (resolution 'reset') via transition() so the board starts clean for the new run; per-item
  // rows stay durable (hidden, not deleted — I12). Active/awaiting work is never touched. This
  // is a declarative knob; the behavior lives in pipelineService.dispatch().
  resetOnStart?: boolean
}

// A delivery destination: an internal worker (same workflow) or another workflow's
// published input contract. The model never produces these — only the human does.
export type Destination =
  | { kind: 'agent'; agentId: string }
  | { kind: 'contract'; workflow: string; input: string }

// The single place that namespaces an agent placement so the same agent reused in
// two workflows becomes two independent CopilotKit instances.
export function instanceId(workflowId: string, agentId: string): string {
  return `${workflowId}__${agentId}`
}

// Structure-only validation (mirrors defineAgent's philosophy). Uses imperative
// throws rather than a zod schema + superRefine because the descriptor holds LIVE
// objects (zod schema instances in `inputs`, already-validated agent defs) rather
// than plain JSON — so it throws on the first violation. Provider/registry existence
// is checked at wiring time, not here.
export function defineWorkflow(def: WorkflowDescriptor): WorkflowDescriptor {
  const ids = def.agents.map((a) => a.agent.id)
  const dupId = ids.find((id, i) => ids.indexOf(id) !== i)
  if (dupId) throw new Error(`workflow "${def.id}": duplicate agent id "${dupId}"`)

  const inputAgentIds = new Set(def.agents.filter((a) => a.role === 'input').map((a) => a.agent.id))
  const allIds = new Set(ids)

  if (!inputAgentIds.has(def.entryAgentId)) {
    throw new Error(
      `workflow "${def.id}": entry agent "${def.entryAgentId}" is not a role:input agent`
    )
  }

  for (const a of def.agents) {
    for (const target of a.agent.handoffs ?? []) {
      if (!allIds.has(target)) {
        throw new Error(
          `workflow "${def.id}": agent "${a.agent.id}" hands off to "${target}" which is not in this workflow`
        )
      }
    }
  }

  const names = def.inputs.map((i) => i.name)
  const dupName = names.find((n, i) => names.indexOf(n) !== i)
  if (dupName) throw new Error(`workflow "${def.id}": duplicate published input name "${dupName}"`)

  for (const input of def.inputs) {
    if (!inputAgentIds.has(input.agentId)) {
      throw new Error(
        `workflow "${def.id}": input "${input.name}" is bound to "${input.agentId}" which is not a role:input agent`
      )
    }
  }

  return def
}
