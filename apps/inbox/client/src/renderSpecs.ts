import type { ReactElement } from 'react'
import type { z } from 'zod'
import type { Destination } from '@platform/core'
import type { IconName } from './components/Icon'
import { renderRegistry } from './renderRegistry'

export type AgentMeta = { subtitle: string; iconName: IconName; intro: string }
export type DeliverFn = (origin: string, dest: Destination, payload: unknown) => void
export type Registry = typeof renderRegistry

// A pure render tool (generative UI). `render` may call `deliver` for handoff cards.
export type RenderSpec = {
  toolName: string
  parameters: z.ZodTypeAny
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render: (ctx: { parameters: any }, deliver: DeliverFn, registry: Registry) => ReactElement
}

// A human-in-the-loop tool (pauses the run for approval).
export type HitlSpec = {
  toolName: string
  parameters: z.ZodTypeAny
  render: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctx: { args: any; status: string; respond?: (v: string) => void | Promise<void> },
    registry: Registry
  ) => ReactElement
}
