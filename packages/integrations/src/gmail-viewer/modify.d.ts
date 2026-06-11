// Type declarations for modify.mjs (JS module — no TS source).
export type BatchActionResult =
  | { done: string[]; failed: { messageId: string; error: string }[] }
  | { error: string }

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
