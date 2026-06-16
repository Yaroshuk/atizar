import './load-dev-env.js' // MUST be first: loads .env.local (dev) before any env read below
import { createServer, isDemo } from '@atizar/server'
import { providerRegistry } from './providers.js'
import { buildProvider } from './build-agent.js'
import { workflowServers } from './workflows.js'
import { scopesFor, connectionList } from './connections.js'

// In demo mode only the flagship email-inbox workflow is enabled (zero-cred showcase); otherwise
// all workflows are active (null = all).
const ENABLED_WORKFLOWS: string[] | null = isDemo() ? ['email-inbox'] : null

void createServer({
  workflowServers,
  providerRegistry,
  buildProvider,
  connections: connectionList,
  scopesFor,
  enabledWorkflows: ENABLED_WORKFLOWS,
  // The email-inbox instance-key policy (the framework declares the seam; the literals live HERE):
  // reply correlates per sender (one reply instance per email address); the sorter + batch agents
  // (reader/spam/important) each collapse to a single constant instance (the agent id).
  instanceKeyOf: (agentId, payload) => {
    const bare = agentId.includes('__') ? agentId.slice(agentId.indexOf('__') + 2) : agentId
    if (bare === 'reply') {
      const email = (payload as { email?: { from?: string } }).email
      return email?.from ?? agentId // a malformed reply payload falls back to one instance per agent
    }
    return agentId // sorter + batch agents (reader/spam/important) = one constant instance each
  },
  start: true,
}).catch((err) => {
  console.error('[server] boot failed:', err)
  process.exit(1)
})
