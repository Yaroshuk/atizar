// Type declaration for check-credentials.mjs (JS module — no TS source).
export declare function checkCredentials(deps?: {
  getGmail?: () => Promise<unknown>
}): Promise<{ ok: true; email: string } | { ok: false; error: string; hint: string }>
