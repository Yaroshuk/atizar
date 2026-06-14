import type { ReactElement } from 'react'
import type { z } from 'zod'
import type { Destination } from '@atizar/core'
import type { IconName } from './components/Icon/Icon'

export type AgentMeta = { subtitle: string; iconName: IconName; intro: string }
export type DeliverFn = (origin: string, dest: Destination, payload: unknown) => void

// A pure render tool (generative UI). `render` may call `deliver` for handoff cards. The
// render closure references its card component DIRECTLY (userland) — the package never holds a
// name→component registry (collapsed at the @atizar/react extraction, mirrors the `effects`
// pattern: names in core for I15, implementations bound outside).
export type RenderSpec = {
  toolName: string
  parameters: z.ZodTypeAny
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render: (ctx: { parameters: any }, deliver: DeliverFn) => ReactElement
}

// A human-in-the-loop tool (the run is paused at a server-side GATE). The GATE is
// authoritative — the card edits the gate's `form` and calls approve(editedForm) /
// reject(comment), which POST /api/gates/:id/resolve (see useGate). Concurrent approvals are
// independent gate rows, not a shared resolver.
export type HitlSpec = {
  toolName: string
  parameters: z.ZodTypeAny
  render: (ctx: {
    form: Record<string, unknown>
    formRev: number
    status: string
    // The untrusted source the agent reacted to (the open work item's payload) — the incoming
    // email/ticket. Fed beside the editable draft so the human can spot prompt-injection or a
    // mismatch between source and proposed action. The card composes <SourcePanel source={…}/>.
    source: Record<string, unknown>
    approve: (form: Record<string, unknown>) => void
    reject: (comment?: string) => void
  }) => ReactElement
}
