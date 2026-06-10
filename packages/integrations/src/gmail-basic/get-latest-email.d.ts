// Type declaration for get-latest-email.mjs (JS module — no TS source).
export declare function getLatestEmail(deps?: {
  getGmail?: () => Promise<unknown>
}): Promise<{ threadId: string; from: string; subject: string; body: string } | { error: string }>
