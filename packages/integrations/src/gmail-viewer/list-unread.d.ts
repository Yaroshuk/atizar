// Type declaration for list-unread.mjs (JS module — no TS source).
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
): Promise<{ emails: EmailRef[] } | { error: string }>
