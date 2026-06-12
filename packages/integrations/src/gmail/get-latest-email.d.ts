// Type declaration for get-latest-email.mjs (JS module — no TS source).
import type { ResolvedCredential } from '@platform/core'

export declare function getLatestEmail(
  args?: unknown,
  deps?: { credential?: ResolvedCredential; gmail?: unknown }
): Promise<{ threadId: string; from: string; subject: string; body: string } | { error: string }>
