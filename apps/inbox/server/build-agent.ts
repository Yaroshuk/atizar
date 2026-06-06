import { BuiltInAgent } from "@copilotkit/runtime/v2";
import type { AgentDefinition } from "../core/defineAgent.js";
import type { ProviderRegistry } from "../core/providers.js";

// Builds the CopilotKit BuiltInAgent for an agent passport: resolves the
// provider from the registry by `def.provider` and delegates the event stream to
// `provider.run(input)`. All approval/turn logic lives in the provider (which
// reads `def.approvals`), so there is no hardcoded tool name here.
export function buildAgent(
  def: AgentDefinition,
  registry: ProviderRegistry,
): BuiltInAgent {
  const provider = registry.resolve(def.provider);
  return new BuiltInAgent({
    type: "custom",
    factory: ({ input }) => provider.run(input),
  });
}
