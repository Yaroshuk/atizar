import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { CopilotRuntime, createCopilotEndpoint, InMemoryAgentRunner } from '@copilotkit/runtime/v2'
import { qualifierAgent, replyAgent, agents as inboxAgents } from '../agents/inbox.agent.js'
import {
  triageAgent,
  featureAgent,
  bugfixAgent,
  replyDraftAgent,
  githubAgents,
} from '../agents/github.agent.js'
import { createQualifierPrompts } from '../agents/qualifier.prompts.js'
import { createReplyPrompts } from '../agents/reply.prompts.js'
import { createTriagePrompts } from '../agents/triage.prompts.js'
import { createTicketPrompts } from '../agents/ticket.prompts.js'
import { providerRegistry } from './providers.js'
import { buildAgent } from './build-agent.js'

// Wiring-time check: a passport must not hand off to an agent that isn't registered.
const allAgents = [...inboxAgents, ...githubAgents]
const knownIds = new Set(allAgents.map((a) => a.id))
for (const a of allAgents) {
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
const TRIAGE_TOOLS = [
  'mcp__github__list_my_tickets',
  'mcp__github__get_ticket',
  'mcp__github__render_triage',
]
const FEATURE_TOOLS = ['mcp__github__render_ticket_result']
const BUGFIX_TOOLS = ['mcp__github__render_ticket_result']
const REPLY_DRAFT_TOOLS = ['mcp__github__render_reply_draft']

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
    [triageAgent.id]: buildAgent(
      triageAgent,
      createTriagePrompts(triageAgent.instructions),
      providerRegistry,
      TRIAGE_TOOLS
    ),
    [featureAgent.id]: buildAgent(
      featureAgent,
      createTicketPrompts(featureAgent.instructions, {
        renderTool: 'render_ticket_result',
        kind: 'feature',
      }),
      providerRegistry,
      FEATURE_TOOLS
    ),
    [bugfixAgent.id]: buildAgent(
      bugfixAgent,
      createTicketPrompts(bugfixAgent.instructions, {
        renderTool: 'render_ticket_result',
        kind: 'bug',
      }),
      providerRegistry,
      BUGFIX_TOOLS
    ),
    [replyDraftAgent.id]: buildAgent(
      replyDraftAgent,
      createTicketPrompts(replyDraftAgent.instructions, {
        renderTool: 'render_reply_draft',
        kind: 'reply',
      }),
      providerRegistry,
      REPLY_DRAFT_TOOLS
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
