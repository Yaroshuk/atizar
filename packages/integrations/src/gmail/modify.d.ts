// Type declarations for modify.mjs (JS module — no TS source).
import type { BatchActionResult, ResolvedCredential } from '@atizar/core'

export declare function markRead(
  args: { messageIds: string[] },
  deps?: { credential?: ResolvedCredential; gmail?: unknown }
): Promise<BatchActionResult>

export declare function trash(
  args: { messageIds: string[] },
  deps?: { credential?: ResolvedCredential; gmail?: unknown }
): Promise<BatchActionResult>

export declare function star(
  args: { messageIds: string[] },
  deps?: { credential?: ResolvedCredential; gmail?: unknown }
): Promise<BatchActionResult>
