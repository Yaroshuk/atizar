import type { Destination, WorkflowDescriptor } from '@platform/core'
import { instanceId } from '@platform/core'

export type DeliveryResult =
  | { ok: true; instanceId: string; targetWorkflow?: string }
  | { ok: false; error: string }

// Pure resolution of a delivery. Intra-workflow → instance in the origin workflow.
// Cross-workflow → the target's published input contract, validated by its schema;
// resolves to the PRIVATE bound input agent (the caller never names it).
export function resolveDelivery(
  workflows: WorkflowDescriptor[],
  origin: string,
  dest: Destination,
  payload: unknown
): DeliveryResult {
  if (dest.kind === 'agent') {
    return { ok: true, instanceId: instanceId(origin, dest.agentId) }
  }
  const wf = workflows.find((w) => w.id === dest.workflow)
  if (!wf) return { ok: false, error: `unknown workflow "${dest.workflow}"` }
  const input = wf.inputs.find((i) => i.name === dest.input)
  if (!input) return { ok: false, error: `workflow "${dest.workflow}" has no input "${dest.input}"` }
  if (!input.schema.safeParse(payload).success) {
    return { ok: false, error: `payload does not match contract "${dest.workflow}.${dest.input}"` }
  }
  return { ok: true, instanceId: instanceId(wf.id, input.agentId), targetWorkflow: wf.id }
}
