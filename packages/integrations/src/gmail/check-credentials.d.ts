// Type declaration for check-credentials.mjs (JS module — no TS source).
import type { HealthCheck, ResolvedCredential } from '@platform/core'

export declare function checkCredentials(deps?: {
  credential?: ResolvedCredential
  gmail?: unknown
}): Promise<HealthCheck>
