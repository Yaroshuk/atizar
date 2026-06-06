import { defineProviders, type ProviderRegistry } from '../core/providers.js'
import { createMockInboxProvider } from '../core/mock-provider.js'
import { createClaudeCliProvider } from '../core/claude-cli-provider.js'
import { inboxAgent } from '../core/inbox.agent.js'
import { claudeSpawn } from './claude-spawn.js'

// Runtime registry (server-only — claude-cli needs Node). Agents reference a
// provider by name; `mock` stays available for fallback / manual testing.
export const providerRegistry: ProviderRegistry = defineProviders({
  mock: createMockInboxProvider(inboxAgent.approvals),
  'claude-cli': createClaudeCliProvider({
    approvalNames: inboxAgent.approvals,
    instructions: inboxAgent.instructions,
    spawn: claudeSpawn,
  }),
})
