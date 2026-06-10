// @platform/server — the server-authoritative pipeline engine (StateStore, dispatch,
// transition, WorkerPool, RunObserver, gate-keyed resolve, board/thread HTTP+SSE).
// Public surface consumed by the app's composition root.
export { db, databaseUrl, closeDb } from './db/client.js'
export type { Db } from './db/client.js'
export { runMigrations } from './db/migrate.js'
export { resetDb } from './db/reset.js'
export { startupSweep } from './sweep.js'
export { makePipelineService } from './pipelineService.js'
export type { PipelineService, DispatchRequest, TraceSnapshot } from './pipelineService.js'
export { createPipelineRoutes } from './routes.js'
export type { AgentRuntime } from './runObserver.js'
