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
  start: true,
}).catch((err) => {
  console.error('[server] boot failed:', err)
  process.exit(1)
})
