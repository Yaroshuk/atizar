import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { CopilotRuntime, createCopilotEndpoint, InMemoryAgentRunner } from '@copilotkit/runtime/v2'
import { qualifierAgent, replyAgent, agents } from '../core/inbox.agent.js'
import { createQualifierPrompts } from '../core/agents/qualifier.prompts.js'
import { createReplyPrompts } from '../core/agents/reply.prompts.js'
import { providerRegistry } from './providers.js'
import { buildAgent } from './build-agent.js'

// Wiring-time check: a passport must not hand off to an agent that isn't registered.
const knownIds = new Set(agents.map((a) => a.id))
for (const a of agents) {
  for (const target of a.handoffs ?? []) {
    if (!knownIds.has(target)) {
      throw new Error(`Agent "${a.id}" hands off to unknown agent "${target}"`)
    }
  }
}

// Per-agent MCP allow-lists — the single-entry-point boundary, enforced at the
// permission layer (not just prompts). The QUALIFIER is the ONLY reader of the
// inbox; the REPLY agent is a writer that cannot call get_latest_email. (These
// fully-qualified MCP names are a server/runtime detail, so they live here, not in
// the React-free passport.)
const QUALIFIER_TOOLS = ['mcp__inbox__renderVerdict', 'mcp__gmail__get_latest_email']
const REPLY_TOOLS = ['mcp__inbox__renderLead', 'mcp__inbox__saveDraft', 'mcp__gmail__create_draft']

const runtime = new CopilotRuntime({
  agents: {
    [qualifierAgent.id]: buildAgent(
      qualifierAgent,
      createQualifierPrompts(qualifierAgent.instructions),
      providerRegistry,
      QUALIFIER_TOOLS
    ),
    [replyAgent.id]: buildAgent(
      replyAgent,
      createReplyPrompts(replyAgent.instructions),
      providerRegistry,
      REPLY_TOOLS
    ),
  },
  runner: new InMemoryAgentRunner(),
})

// single-route: ONE POST endpoint at the bare basePath, matching the v2 client's
// default single-endpoint transport (see CLAUDE.md → CopilotKit v2 API notes).
const copilot = createCopilotEndpoint({
  runtime,
  basePath: '/api/copilotkit',
  mode: 'single-route',
})

const app = new Hono()
app.route('/', copilot)

serve({ fetch: app.fetch, port: 4000 })
console.log('server on http://localhost:4000')
