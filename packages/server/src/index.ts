// @atizar/server — the server-authoritative pipeline engine (StateStore, dispatch,
// transition, WorkerPool, RunObserver, gate-keyed resolve, board/thread HTTP+SSE).
// Public surface consumed by the app's composition root.
export { db, databaseUrl, closeDb } from './db/client.js'
export { atizarEnv, isDemo } from './env.js'
export type { Db } from './db/client.js'
export { runMigrations } from './db/migrate.js'
export { resetDb, resetCredentials, resetAll } from './db/reset.js'
export { startupSweep } from './sweep.js'
export { makePipelineService } from './pipelineService.js'
export type { PipelineService, DispatchRequest, TraceSnapshot } from './pipelineService.js'
export { createPipelineRoutes } from './routes.js'
export type { AgentRuntime } from './runObserver.js'
export { makeActivityLog } from './activity.js'
export type { ActivityEntry, ActivityLog } from './activity.js'
export { resolveCredential, registerResolver } from './resolveCredential.js'
export type { ResolveCtx, ResolveDeps } from './resolveCredential.js'
export { makeCredentialStore } from './credentialStore.js'
export type { CredentialStore, StoredCredential } from './credentialStore.js'
export { oauthProvider } from './oauthProviders.js'
export type { OAuthProvider } from './oauthProviders.js'
export { createConnectRoutes } from './connectRoutes.js'
export type { ConnectRoutesDeps, ConnectionDescriptor } from './connectRoutes.js'
export { createAuthMiddleware } from './auth.js'
export {
  withRecordReplay,
  CassetteStore,
  recordReplayMode,
  encodeLine,
  parseLine,
  eventsForStep,
  dropStep,
  scanCassette,
} from './recordReplay.js'
export type { Finding, RecordReplayMode } from './recordReplay.js'
export { assertAgentClassification } from './agentChecks.js'
export { deriveConnectionList } from './connectRoutes.js'
export { providerHealth } from './providerHealth.js'
export { parseEnvFile } from './parseEnv.js'
export { loadDevEnv } from './loadDevEnv.js'
export { makeClaudeSpawn } from './makeClaudeSpawn.js'
export type { ClaudeSpawnOptions, McpServerSpec } from './makeClaudeSpawn.js'
export { buildAgentProvider } from './buildAgent.js'
export type { BuildAgentWrap, BuildAgentArgs } from './buildAgent.js'
// NOTE: captureTool is NOT re-exported here — it lives behind the `@atizar/server/mastra` subpath.
// mastraTools.ts eagerly imports `@mastra/core`, so re-exporting it from the main index would force
// EVERY consumer of `@atizar/server` to load Mastra at boot (heavy) even when they use another
// provider. Mastra users import it from `@atizar/server/mastra`.
export { createServer } from './createServer.js'
export type {
  CreateServerArgs,
  BuiltServer,
  BuildProviderFn,
  WorkflowServerLike,
  ServerBindingLike,
} from './createServer.js'
