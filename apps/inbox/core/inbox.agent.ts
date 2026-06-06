import { defineAgent } from './defineAgent.js'

// The inbox agent passport — single source of truth read by the server adapter
// and the client glue. The provider is resolved at runtime by the server's
// registry (apps/inbox/server/providers.ts); no registry is built here because
// the real provider needs Node and core/ is imported by the client.
export const inboxAgent = defineAgent({
  id: 'inbox',
  name: 'EMAIL AGENT',
  provider: 'claude-cli',
  instructions: 'Check the inbox, surface a lead, and ask before replying.',
  tools: ['renderLead', 'confirmSend'],
  approvals: ['confirmSend'],
  renders: { renderLead: 'LeadCard', confirmSend: 'ApprovalDialog' },
})
