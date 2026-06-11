// Type declarations for modify.mjs (JS module — no TS source).
import type { BatchActionResult } from '@platform/core'

export declare function markRead(
  args: { messageIds: string[] },
  deps?: { getGmail?: () => Promise<unknown> }
): Promise<BatchActionResult>

export declare function trash(
  args: { messageIds: string[] },
  deps?: { getGmail?: () => Promise<unknown> }
): Promise<BatchActionResult>

export declare function star(
  args: { messageIds: string[] },
  deps?: { getGmail?: () => Promise<unknown> }
): Promise<BatchActionResult>
