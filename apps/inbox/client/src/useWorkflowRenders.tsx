import { useRenderTool } from '@copilotkit/react-core/v2'
import { renderRegistry } from './renderRegistry'
import { renderSpecs } from './workflows'
import type { DeliverFn } from './renderSpecs'

// Registers every unique pure render tool ONCE, globally (specs are module-static, so
// the hook order is stable across renders — safe to loop). The shared closure reads
// origin from the tool params, so a reused agent's card routes its handoff to the right
// copy. Render tools are stateless display, so a single global registration is fine.
//
// HITL tools are NOT registered here — they are registered PER live instance (see
// InstanceTools) so each instance gets its own `respond`. A global HITL registration
// shares one resolver across all runs, which kills the approve button on a second
// concurrently-awaiting instance.
export const useWorkflowRenders = (deliver: DeliverFn) => {
  renderSpecs.forEach((spec) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useRenderTool(
      {
        name: spec.toolName,
        parameters: spec.parameters,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        render: (ctx: any) => spec.render(ctx, deliver, renderRegistry),
      },
      [deliver]
    )
  })
}
