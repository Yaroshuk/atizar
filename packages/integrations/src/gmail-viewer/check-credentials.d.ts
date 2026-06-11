import type { HealthCheck } from '@platform/core'
export declare function checkCredentials(deps?: {
  getGmail?: () => Promise<unknown>
}): Promise<HealthCheck>
