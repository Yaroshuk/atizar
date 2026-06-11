// Type declaration for get-email.mjs (JS module — no TS source).
export declare function getEmail(
  args: { messageId: string },
  deps?: { getGmail?: () => Promise<unknown> }
): Promise<
  | { messageId: string; threadId: string; from: string; subject: string; body: string }
  | { error: string }
>
