import { execSync } from 'node:child_process'
import type { HealthCheck } from '@platform/core'

// Aggregate a set of credential/provider checks for ONE agent into a single HealthCheck:
// the first failing check (so an agent with any unhealthy dependency is unhealthy), else ok.
// An empty array has no failing checks and returns ok:true (no checks = no constraints).
export function aggregateHealth(checks: HealthCheck[]): HealthCheck {
  for (const c of checks) {
    if (!c.ok) return c
  }
  return { ok: true }
}

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
