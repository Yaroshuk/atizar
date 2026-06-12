// Dev-only autoloader for `.env.local`. Imported as the FIRST line of `server/index.ts` so it
// runs (as an import side effect) before any other module reads `process.env` at init time
// (e.g. `providers.ts` reads `PROVIDER`). Walks up from cwd to find the repo-root `.env.local`,
// parses it, and sets each var ONLY if it is not already in the environment — so a var passed
// explicitly on the CLI (`PROVIDER=mastra yarn dev`) always wins. Skipped in production
// (`.env.local` is gitignored and never deployed, but the NODE_ENV gate is the explicit guard).
// This removes the old footgun where the dev server needed `set -a; . ./.env.local; set +a`
// for ATIZAR_* (credential decryption / OAuth) and PROVIDER to take effect.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'
import { parseEnvFile } from './parse-env.js'

function findEnvFile(start: string): string | null {
  let dir = start
  const { root } = parse(dir)
  for (;;) {
    const candidate = join(dir, '.env.local')
    if (existsSync(candidate)) return candidate
    if (dir === root) return null
    dir = dirname(dir)
  }
}

if (process.env.NODE_ENV !== 'production') {
  const file = findEnvFile(process.cwd())
  if (file) {
    const parsed = parseEnvFile(readFileSync(file, 'utf8'))
    let loaded = 0
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = value
        loaded++
      }
    }
    if (loaded > 0) console.log(`[dev] loaded ${loaded} var(s) from ${file}`)
  }
}
