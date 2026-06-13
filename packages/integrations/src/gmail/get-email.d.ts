// Type declaration for get-email.mjs (JS module — no TS source).
import type { ReadResult, ResolvedCredential } from '@atizar/core'

export declare function getEmail(
  args: { messageId: string },
  deps?: { credential?: ResolvedCredential; gmail?: unknown }
): Promise<
  ReadResult<{ messageId: string; threadId: string; from: string; subject: string; body: string }>
>
