import { useHumanInTheLoop } from '@copilotkit/react-core/v2'
import { renderRegistry } from './renderRegistry'
import { hitlSpecs } from './workflows'

type InstanceToolsProps = { agentId: string }

// Registers this live instance's human-in-the-loop tools under its OWN agentId (the
// proxied agent's localId). One InstanceTools is mounted per live instance, keyed by
// localId, so each instance gets a DISTINCT useHumanInTheLoop registration — and thus
// its own `respond` callback (a fresh resolvePromiseRef per hook).
//
// Why per-instance: a single global useHumanInTheLoop shares ONE resolvePromiseRef
// across every run, so when two instances pause at the same approval tool call the
// second run overwrites the first's resolver and the first instance's approve button
// goes dead. CopilotKit keys tools and renders by `${agentId}:${name}`, and core looks
// up the handler via getTool({ toolName, agentId: agent.agentId }) where the proxied
// agent's agentId IS the localId — so registering under localId routes each run to its
// own handler. The matching render is resolved by wrapping the open modal in a
// <CopilotChatConfigurationProvider agentId={localId}> (see LiveInstanceModal).
//
// hitlSpecs is module-static, so the forEach hook order is stable for this component;
// the whole component mounts/unmounts as the instance comes and goes (rules of hooks
// hold because agentId is constant for a given mount).
export const InstanceTools = ({ agentId }: InstanceToolsProps) => {
  hitlSpecs.forEach((spec) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useHumanInTheLoop(
      {
        name: spec.toolName,
        parameters: spec.parameters,
        agentId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        render: (ctx: any) => spec.render(ctx, renderRegistry),
      },
      []
    )
  })
  return null
}
