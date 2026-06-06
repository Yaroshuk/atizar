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
  })

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>

export function defineAgent(def: AgentDefinition): AgentDefinition {
  return AgentDefinitionSchema.parse(def)
}
