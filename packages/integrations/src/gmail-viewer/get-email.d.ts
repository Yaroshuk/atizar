// Type declaration for get-email.mjs (JS module — no TS source).
import type { ReadResult } from '@platform/core'

export declare function getEmail(
  args: { messageId: string },
  deps?: { getGmail?: () => Promise<unknown> }
): Promise<
  ReadResult<{ messageId: string; threadId: string; from: string; subject: string; body: string }>
>
