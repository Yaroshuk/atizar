import { useRenderTool, useHumanInTheLoop } from '@copilotkit/react-core/v2'
import { renderRegistry } from './renderRegistry'
import { renderSpecs, hitlSpecs } from './workflows'
import type { DeliverFn } from './renderSpecs'

// Registers every unique render/HITL tool ONCE (specs are module-static, so the hook
// order is stable across renders — safe to loop). The shared closure reads origin from
// the tool params, so a reused agent's card routes its handoff to the right copy.
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
  hitlSpecs.forEach((spec) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useHumanInTheLoop(
      {
        name: spec.toolName,
        parameters: spec.parameters,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        render: (ctx: any) => spec.render(ctx, renderRegistry),
      },
      []
    )
  })
}
