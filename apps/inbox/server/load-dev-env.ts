// Dev-only `.env.local` autoloader. Imported as the FIRST line of `server/index.ts` so it runs
// (as an import side effect) before any other module reads `process.env`. The reusable logic now
// lives in @atizar/server (WS7 move 5); this shim keeps the import-for-side-effect contract.
import { loadDevEnv } from '@atizar/server'

loadDevEnv()
