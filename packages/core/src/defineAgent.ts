import { z } from 'zod'

// One object describes an agent; the server adapter and client glue both derive
// from it. Pure data — no React, no runtime code. `fields` is intentionally
// omitted this phase (no form/DB consumer yet).
export const AgentDefinitionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    provider: z.string(),
    instructions: z.string(),
    tools: z.array(z.string()),
    approvals: z.array(z.string()),
    renders: z.record(z.string()),
    // Target agent ids this agent may hand off to. Structure only — membership in
    // the agent registry is checked at wiring time (a passport doesn't know it).
    handoffs: z.array(z.string()).optional(),
    // Max concurrent runtime copies of this agent. A cap of 1 = singleton.
    maxInstances: z.number().int().positive().default(2),
    // Approval tools whose resolution triggers a SERVER-executed effect (the function
    // lives in the workflow ServerBinding; the model never sees an effect tool).
    effects: z.array(z.string()).default([]),
    // Read-only tools, declared so the boot-time allow-list classification is exhaustive.
    readonly: z.array(z.string()).default([]),
  })
  .superRefine((def, ctx) => {
    for (const name of def.approvals) {
      if (!def.tools.includes(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `approval "${name}" is not declared in tools`,
        })
      }
    }
    for (const key of Object.keys(def.renders)) {
      if (!def.tools.includes(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `render key "${key}" is not declared in tools`,
        })
      }
    }
    for (const name of def.effects) {
      if (!def.approvals.includes(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `effect "${name}" is not an approval`,
        })
      }
    }
  })

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>
export type AgentDefinitionInput = z.input<typeof AgentDefinitionSchema>

export function defineAgent(def: AgentDefinitionInput): AgentDefinition {
  return AgentDefinitionSchema.parse(def)
}
