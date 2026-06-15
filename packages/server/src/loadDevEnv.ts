// Dev-only autoloader for `.env.local`. Call it as the FIRST line of a server entry point so it
// runs before any module reads `process.env` at init time. Walks up from cwd to find the repo-root
// `.env.local`, parses it, and sets each var ONLY if not already in the environment — so a var
// passed explicitly on the CLI (`PROVIDER=mastra yarn dev`) always wins. Skipped in production
// (`.env.local` is gitignored and never deployed; the NODE_ENV gate is the explicit guard).
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'
import { parseEnvFile } from './parseEnv.js'

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

export function loadDevEnv(): void {
  if (process.env.NODE_ENV === 'production') return
  const file = findEnvFile(process.cwd())
  if (!file) return
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
