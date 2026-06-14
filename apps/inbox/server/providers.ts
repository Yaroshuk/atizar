import { defineProviders, type ProviderRegistry, type ProviderFactory } from '@atizar/core'
import {
  createMockInboxProvider,
  createClaudeCliProvider,
  createMastraProvider,
  PROVIDERS,
} from '@atizar/providers'
import { claudeSpawn } from './claude-spawn.js'
import { makeMastraRunner } from './mastra/runner.js'
import { databaseUrl } from '@atizar/server'

const MASTRA_MODEL = process.env.MASTRA_MODEL ?? 'claude-sonnet-4-6'

// Mastra factory: derive the agent's read vs render/propose tools from its allow-list (strip the
// mcp prefix), build a MastraRunner, and wrap it in the provider. Fails fast without an API key.
const mastraFactory: ProviderFactory = (config) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('PROVIDER=mastra requires ANTHROPIC_API_KEY')
  }
  // Strip the `mcp__<server>__` prefix. Non-greedy `.+?__` tolerates a server name with an
  // underscore (e.g. `mcp__my_server__tool`), unlike a `[^_]+` segment.
  const bare = (config.allowedTools ?? []).map((t) => t.replace(/^mcp__.+?__/, ''))
  const renderAndProposeTools = bare.filter((t) => config.surfaceTools.includes(t))
  const readTools = bare.filter(
    (t) => !config.surfaceTools.includes(t) && !config.approvalNames.includes(t)
  )
  const runner = makeMastraRunner({
    agentId: config.agentId,
    instructions: config.instructions,
    approvalNames: config.approvalNames,
    readTools,
    renderAndProposeTools,
    model: MASTRA_MODEL,
    // Reuse the pipeline's resolved DB URL (defaults to the compose creds) — a single source
    // of truth, so PROVIDER=mastra needs no extra env beyond ANTHROPIC_API_KEY.
    databaseUrl,
    // The SAME PromptStrategy claude-cli uses — one prompt source for both providers.
    prompts: config.prompts,
  })
  return createMastraProvider({
    approvalNames: config.approvalNames,
    surfaceTools: config.surfaceTools,
    runner,
  })
}

const usingMastra = process.env.PROVIDER === 'mastra'

// Runtime registry (server-only). When PROVIDER=mastra, claude-cli-declared agents resolve to the
// Mastra factory (descriptors keep provider:'claude-cli' — no descriptor churn). Default = claude-cli.
export const providerRegistry: ProviderRegistry = defineProviders({
  [PROVIDERS.mock]: (config) => createMockInboxProvider(config.approvalNames),
  [PROVIDERS.claudeCli]: usingMastra
    ? mastraFactory
    : (config) =>
        createClaudeCliProvider({
          approvalNames: config.approvalNames,
          surfaceTools: config.surfaceTools,
          allowedTools: config.allowedTools,
          prompts: config.prompts,
          spawn: claudeSpawn,
        }),
  [PROVIDERS.mastra]: mastraFactory,
})
