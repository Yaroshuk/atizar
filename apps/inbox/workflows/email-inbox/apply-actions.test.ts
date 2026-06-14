// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { applyEmailActions } from './apply-actions.js'

function fakes() {
  const calls: Record<string, string[]> = { read: [], trash: [], star: [] }
  return {
    calls,
    deps: {
      markRead: async ({ messageIds }: { messageIds: string[] }) => {
        calls.read.push(...messageIds)
        return { done: messageIds, failed: [] }
      },
      trash: async ({ messageIds }: { messageIds: string[] }) => {
        calls.trash.push(...messageIds)
        return { done: messageIds, failed: [] }
      },
      star: async ({ messageIds }: { messageIds: string[] }) => {
        calls.star.push(...messageIds)
        return { done: messageIds, failed: [] }
      },
    },
  }
}

describe('applyEmailActions', () => {
  it('groups rows by action and calls the matching batch mutation once each', async () => {
    const { calls, deps } = fakes()
    const form = {
      items: [
        { messageId: 'a', action: 'read' as const },
        { messageId: 'b', action: 'trash' as const },
        { messageId: 'c', action: 'read' as const },
        { messageId: 'd', action: 'star' as const },
        { messageId: 'e', action: 'keep' as const },
      ],
    }
    const res = await applyEmailActions(form, deps)
    expect(calls.read).toEqual(['a', 'c'])
    expect(calls.trash).toEqual(['b'])
    expect(calls.star).toEqual(['d'])
    expect(res.applied).toBe(4) // keep is not an action
    expect(res.failed).toEqual([])
    expect(res.byAction).toEqual({ read: 2, trash: 1, star: 1 })
  })

  it('is best-effort: a failed row is collected, the rest still applied', async () => {
    const deps = {
      markRead: async ({ messageIds }: { messageIds: string[] }) => ({
        done: messageIds.filter((m) => m !== 'bad'),
        failed: messageIds.filter((m) => m === 'bad').map((m) => ({ messageId: m, error: 'boom' })),
      }),
      trash: async ({ messageIds }: { messageIds: string[] }) => ({ done: messageIds, failed: [] }),
      star: async ({ messageIds }: { messageIds: string[] }) => ({ done: messageIds, failed: [] }),
    }
    const res = await applyEmailActions(
      {
        items: [
          { messageId: 'a', action: 'read' as const },
          { messageId: 'bad', action: 'read' as const },
        ],
      },
      deps
    )
    expect(res.applied).toBe(1)
    expect(res.failed).toEqual([{ messageId: 'bad', error: 'boom' }])
  })

  it('returns a wholesale error if a batch mutation reports one (client unavailable)', async () => {
    const deps = {
      markRead: async () => ({ error: 'no creds' }),
      trash: async () => ({ done: [], failed: [] }),
      star: async () => ({ done: [], failed: [] }),
    }
    const res = await applyEmailActions(
      { items: [{ messageId: 'a', action: 'read' as const }] },
      deps
    )
    expect(res.error).toMatch(/no creds/)
  })
})
