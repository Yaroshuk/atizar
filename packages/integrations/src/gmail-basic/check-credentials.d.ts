// Type declaration for check-credentials.mjs (JS module — no TS source).
import type { HealthCheck } from '@platform/core'
export declare function checkCredentials(deps?: {
  getGmail?: () => Promise<unknown>
}): Promise<HealthCheck>
