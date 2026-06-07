import { defineProviders, type ProviderRegistry } from '../core/providers.js'
import { createMockInboxProvider } from '../core/mock-provider.js'
import { createClaudeCliProvider } from '../core/claude-cli-provider.js'
import { claudeSpawn } from './claude-spawn.js'

// Runtime registry (server-only — claude-cli needs Node). Each entry is a FACTORY
// built per agent from its passport-derived config. `mock` ignores prompts (it
// scripts its own stream); `claude-cli` uses the injected PromptStrategy + spawn.
// A future Mastra backend is one more factory here.
export const providerRegistry: ProviderRegistry = defineProviders({
  mock: (config) => createMockInboxProvider(config.approvalNames),
  'claude-cli': (config) =>
    createClaudeCliProvider({
      approvalNames: config.approvalNames,
      surfaceTools: config.surfaceTools,
      prompts: config.prompts,
      spawn: claudeSpawn,
    }),
})
