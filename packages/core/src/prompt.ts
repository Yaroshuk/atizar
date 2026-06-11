// Compose an agent's system prompt from an optional workflow-level prompt (shared context for
// every agent in the workflow — tone, rules) and the agent's own instructions. Pure. Used at the
// binding seam so BOTH providers (claude-cli prompt strategy + Mastra config.instructions) see the
// same composed text. A blank/whitespace workflow prompt is a no-op (zero behavior change for a
// workflow that declares none).
export function composeInstructions(
  workflowPrompt: string | undefined,
  agentInstructions: string
): string {
  const wf = workflowPrompt?.trim()
  return wf ? `${wf}\n\n${agentInstructions}` : agentInstructions
}
