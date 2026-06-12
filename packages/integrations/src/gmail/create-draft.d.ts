// Type declaration for create-draft.mjs (JS module — no TS source).
import type { ResolvedCredential } from '@platform/core'

export declare function createDraft(
  args: { threadId: string; body: string },
  deps?: { credential?: ResolvedCredential; gmail?: unknown }
): Promise<{ ok: true; draftId: string | null | undefined } | { error: string }>
