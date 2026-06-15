// Stamp a workflow's specs with its id, then drop duplicate tool names WITHIN that workflow.
//
// Generic config-merge: the userland aggregator owns each workflow's render/HITL specs but does
// NOT carry the workflow id on them — this stamps it on so resolution can be scoped by
// (workflowId, toolName). Dedup is WITHIN a workflow only (a reused agent registers its render
// once per workflow); the FIRST spec for a given tool name wins. The package stays
// workflow-agnostic — it keys by id, it knows nothing about the cards/payloads.
export const scope = <T extends { toolName: string; workflowId: string }>(
  workflowId: string,
  specs: Omit<T, 'workflowId'>[]
): T[] => {
  const seen = new Set<string>()
  const out: T[] = []
  for (const s of specs) {
    if (seen.has(s.toolName)) continue
    seen.add(s.toolName)
    out.push({ ...s, workflowId } as T)
  }
  return out
}
