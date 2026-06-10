// Type declaration for create-draft.mjs (JS module — no TS source).
export declare function createDraft(
  args: { threadId: string; body: string },
  deps?: { getGmail?: () => Promise<unknown> }
): Promise<{ ok: true; draftId: string | null | undefined } | { error: string }>
