import { execSync } from 'node:child_process'
import type { HealthCheck } from '@atizar/core'

// aggregateHealth now lives in @atizar/core (pure fold, Node-free — I3). Re-exported here so
// existing import sites stay stable until health.ts is fully retired at WS7 move 4.
export { aggregateHealth } from '@atizar/core'

// A provider's own readiness: claude-cli needs the `claude` binary on PATH; mastra needs
// ANTHROPIC_API_KEY; mock is always ok. Never throws (a failing probe returns ok:false).
export function providerHealth(provider: string): HealthCheck {
  if (provider === 'mock') return { ok: true }
  if (provider === 'mastra') {
    return process.env.ANTHROPIC_API_KEY
      ? { ok: true }
      : {
          ok: false,
          error: 'ANTHROPIC_API_KEY not set',
          hint: 'export ANTHROPIC_API_KEY (see HANDOFF provider knobs)',
        }
  }
  if (provider === 'claude-cli') {
    try {
      // `command -v claude` exits non-zero (throws) if the binary is not on PATH.
      execSync('command -v claude', { stdio: 'ignore' })
      return { ok: true }
    } catch {
      return {
        ok: false,
        error: 'claude binary not found on PATH',
        hint: 'install the Claude Code CLI (see HANDOFF provider knobs)',
      }
    }
  }
  // Unknown provider: validated by registry.resolve() at wiring time, so this is unreachable in
  // production. Treat as ok rather than surfacing a confusing false-negative.
  return { ok: true }
}
