// Type declaration for list-unread.mjs (JS module — no TS source).
import type { ReadResult, ResolvedCredential } from '@atizar/core'

export type EmailRef = {
  messageId: string
  threadId: string
  from: string
  subject: string
  date: string
  snippet: string
}

export declare function listUnread(
  args?: { sinceHours?: number },
  deps?: { credential?: ResolvedCredential; gmail?: unknown }
): Promise<ReadResult<{ emails: EmailRef[] }>>
