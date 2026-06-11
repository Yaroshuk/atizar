import type { AgentDefinition, EffectFn } from '@platform/core'

// Strip the `mcp__<server>__` prefix to the bare tool name the passport declares.
function bareName(fullyQualified: string): string {
  if (!fullyQualified.startsWith('mcp__')) return fullyQualified
  const rest = fullyQualified.slice('mcp__'.length)
  const sep = rest.indexOf('__')
  return sep === -1 ? rest : rest.slice(sep + 2)
}

// Boot-time invariants (fail-fast — never a silent approve-time no-op or an ungated effect):
//   1. effect-binding exhaustiveness BOTH ways (declared ⇔ bound).
//   2. every allow-listed tool is classified readonly | approvals | renders | dispatches.
export function assertAgentClassification(
  def: AgentDefinition,
  binding: { allowedTools: string[]; effects?: Record<string, EffectFn> }
): void {
  const declared = new Set(def.effects)
  const bound = new Set(Object.keys(binding.effects ?? {}))
  for (const name of declared) {
    if (!bound.has(name))
      throw new Error(`agent "${def.id}": effect "${name}" declared but not bound`)
  }
  for (const name of bound) {
    if (!declared.has(name))
      throw new Error(`agent "${def.id}": effect "${name}" bound but not declared`)
  }

  const classified = new Set<string>([
    ...def.readonly,
    ...def.approvals,
    ...Object.keys(def.renders),
    ...def.dispatches,
  ])
  for (const tool of binding.allowedTools) {
    const bare = bareName(tool)
    if (!classified.has(bare)) {
      throw new Error(
        `agent "${def.id}": tool "${bare}" (from "${tool}") is not classified — declare it in readonly | approvals | renders | dispatches`
      )
    }
  }
}
