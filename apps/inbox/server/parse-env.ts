// Minimal `.env`-style parser for the dev-only env autoloader (`load-dev-env.ts`). Pure and
// dependency-free: KEY=VALUE per line, `#` comments and blank lines skipped, an optional
// `export ` prefix tolerated, and matching surrounding quotes stripped. NOT a full dotenv
// implementation (no interpolation, no multiline) — the repo's `.env.local` is plain shell
// assignments sourced via `. .env.local`, which is exactly this subset.
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line
      .slice(0, eq)
      .replace(/^export\s+/, '')
      .trim()
    if (!key) continue
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}
