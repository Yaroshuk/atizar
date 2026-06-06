import type { ComponentType } from 'react'
import { LeadCard } from './components/LeadCard'
import { ApprovalDialog } from './components/ApprovalDialog'

// Maps the component *names* referenced by `def.renders` to real React
// components. Keeps the shared passport (core/) free of React imports.
// Heterogeneous registry: each component has its own prop shape, so a single
// element type is genuinely `any` here — there is no common prop contract.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const renderRegistry: Record<string, ComponentType<any>> = {
  LeadCard,
  ApprovalDialog,
}
