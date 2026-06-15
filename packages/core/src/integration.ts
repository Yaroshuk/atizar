// The thin integration contract (email-inbox spec F9). TYPES ONLY — no base class, no
// defineIntegration() wrapper, no runtime registration. An integration is still a set of pure
// functions (the `write-integration` skill's shape); these types only name the recurring RESULT
// shapes so integrations and the server health/effect seams are uniform. Pure: no fs, no Node,
// no engine import (invariant I3 — this lives in @atizar/core, which the client imports).

// The result of an integration's credentials/health probe (the F3 health surface consumes it).
// `ok:false` MUST carry an actionable `hint` (where creds live + which skill explains setup).
export type HealthCheck = { ok: true; detail?: string } | { ok: false; error: string; hint: string }

// A read function's result: the value, or a soft error (integrations never throw — they return).
export type ReadResult<T> = T | { error: string }

// A best-effort batch mutation's result: per-row outcomes collected, or a wholesale error when
// the client itself was unavailable. (gmail-viewer's modify.mjs already returns exactly this.)
export type BatchActionResult =
  | { done: string[]; failed: { messageId: string; error: string }[] }
  | { error: string }

// Narrow a HealthCheck to its ok branch.
export function isOk(h: HealthCheck): h is { ok: true; detail?: string } {
  return h.ok
}

// Aggregate a set of credential/provider checks for ONE agent into a single HealthCheck:
// the first failing check (so an agent with any unhealthy dependency is unhealthy), else ok.
// An empty array has no failing checks and returns ok:true (no checks = no constraints).
// Pure: no fs, no Node, no engine import (invariant I3 — this lives in @atizar/core).
export function aggregateHealth(checks: HealthCheck[]): HealthCheck {
  for (const c of checks) {
    if (!c.ok) return c
  }
  return { ok: true }
}
