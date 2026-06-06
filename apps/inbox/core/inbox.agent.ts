import { defineAgent } from './defineAgent.js'
import { defineProviders } from './providers.js'
import { createMockInboxProvider } from './mock-provider.js'

// The inbox agent passport — the single source of truth read by both the server
// adapter and the client glue.
export const inboxAgent = defineAgent({
  id: 'inbox',
  name: 'EMAIL AGENT',
  provider: 'mock',
  instructions: 'Check the inbox, surface a lead, and ask before replying.',
  tools: ['renderLead', 'confirmSend'],
  approvals: ['confirmSend'],
  renders: { renderLead: 'LeadCard', confirmSend: 'ApprovalDialog' },
})

// Providers defined once; the agent references one by name. The mock reads the
// agent's approval names so its resume detection stays contract-driven.
export const providerRegistry = defineProviders({
  mock: createMockInboxProvider(inboxAgent.approvals),
})
