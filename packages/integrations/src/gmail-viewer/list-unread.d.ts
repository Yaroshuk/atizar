// Type declaration for list-unread.mjs (JS module — no TS source).
import type { ReadResult } from '@platform/core'

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
  deps?: { getGmail?: () => Promise<unknown> }
): Promise<ReadResult<{ emails: EmailRef[] }>>
