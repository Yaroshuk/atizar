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
    // Default is 1: concurrency is opt-in. A wrong-high default risks unwanted
    // concurrency (a correctness/safety hazard); a low default only costs serialization.
    maxInstances: z.number().int().positive().default(1),
    // Approval tools whose resolution triggers a SERVER-executed effect (the function
    // lives in the workflow ServerBinding; the model never sees an effect tool).
    effects: z.array(z.string()).default([]),
    // Read-only tools, declared so the boot-time allow-list classification is exhaustive.
    readonly: z.array(z.string()).default([]),
    // Tools the model calls to spawn a child work item (machine dispatch — I2: allowed).
    // A dispatch tool produces a work item; it never executes an action directly.
    dispatches: z.array(z.string()).default([]),
    // Tools the model calls to ASK another agent and SUSPEND until the answer returns (the return
    // channel). Distinct from `dispatches` (fire-and-forget): an ask suspends the asker into
    // `awaiting_agent`. Declared so the boot-time I15 classification stays exhaustive.
    asks: z.array(z.string()).default([]),
    // ── Return-channel tunables (config-as-data, I7) ─────────────────────────────
    // Maximum depth of chained questions before escalating to a human gate (cycle protection).
    // Round 1 = first ask; a re-entrant ask from an answerer is round 2, etc.
    maxQuestionRounds: z.number().int().positive().default(5),
    // Total token budget across all question rounds (future enforcement — declared now, not yet
    // consumed by the server). Declared so operator config can set it; the server will enforce it
    // once token accounting is wired.
    questionTokenBudget: z.number().int().positive().optional(),
    // Milliseconds before an unanswered question times out and the reaper acts.
    questionTimeoutMs: z.number().int().positive().default(120_000),
    // How many times the reaper retries (re-dispatches the answerer) before escalating to a
    // human gate. 0 = escalate immediately on first timeout.
    maxQuestionRetries: z.number().int().min(0).default(2),
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
    for (const name of def.dispatches) {
      if (!def.tools.includes(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `dispatch "${name}" is not declared in tools`,
        })
      }
    }
    for (const name of def.asks) {
      if (!def.tools.includes(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `ask "${name}" is not declared in tools`,
        })
      }
    }
  })

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>
export type AgentDefinitionInput = z.input<typeof AgentDefinitionSchema>

export function defineAgent(def: AgentDefinitionInput): AgentDefinition {
  return AgentDefinitionSchema.parse(def)
}
