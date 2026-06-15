import { fileURLToPath } from 'node:url'

// The reusable record/replay engine now lives in @atizar/server (WS7 move 2). Re-exported here
// so app-internal import sites stay stable; only the app-specific cassette DIRECTORIES stay local.
export {
  withRecordReplay,
  CassetteStore,
  recordReplayMode,
  encodeLine,
  parseLine,
  eventsForStep,
  dropStep,
  scanCassette,
  type Finding,
  type RecordReplayMode,
} from '@atizar/server'

// apps/inbox/.cassettes/ — resolved relative to this module (server/), so it does
// not depend on the process cwd.
export function cassettesDir(): string {
  return fileURLToPath(new URL('../.cassettes/', import.meta.url))
}

// apps/inbox/demo-cassettes/ — committed SYNTHETIC cassettes for DEMO=1 (never real data).
export function demoCassettesDir(): string {
  return fileURLToPath(new URL('../demo-cassettes/', import.meta.url))
}
