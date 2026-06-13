import type { ResolvedCredential } from '@atizar/core'
import {
  markRead as realMarkRead,
  trash as realTrash,
  star as realStar,
} from '@atizar/integrations/gmail/modify'

type Action = 'read' | 'trash' | 'star' | 'keep'
type Row = { messageId: string; action: Action }
// The batch fns now take a second `deps` arg ({ credential }) so the real gmail mutations build a
// client from the injected credential. Test fakes use the `(args) => …` shape — being called with a
// second arg is harmless (extra positional args are ignored).
type BatchFn = (
  args: { messageIds: string[] },
  deps?: { credential?: ResolvedCredential }
) => Promise<{ done: string[]; failed: { messageId: string; error: string }[] } | { error: string }>
export interface ApplyDeps {
  markRead?: BatchFn
  trash?: BatchFn
  star?: BatchFn
  credential?: ResolvedCredential
}
// A `type` (not `interface`) so it is assignable to Record<string, unknown> at the EffectFn seam
// (TS interfaces lack an implicit index signature; an effect must return Record<string, unknown>).
export type ApplyResult = {
  applied: number
  failed: { messageId: string; error: string }[]
  byAction: Record<string, number>
  error?: string
}

// The server-executed effect for the batch gate. The approved/edited `form` carries the per-row
// actions; group them, run one batch mutation per action group (keep = no-op), collect per-row
// failures (best-effort). A wholesale `{ error }` from any group aborts with that error (the gate
// resolve route fails the work item — never a false "applied"). gmail functions are injected.
export async function applyEmailActions(
  form: { items?: Row[] } | Record<string, unknown>,
  deps: ApplyDeps = {}
): Promise<ApplyResult> {
  const markRead = deps.markRead ?? realMarkRead
  const trash = deps.trash ?? realTrash
  const star = deps.star ?? realStar
  const items = Array.isArray((form as { items?: Row[] }).items)
    ? (form as { items: Row[] }).items
    : []

  const groups: Record<'read' | 'trash' | 'star', string[]> = { read: [], trash: [], star: [] }
  for (const row of items) {
    if (row.action === 'read') groups.read.push(row.messageId)
    else if (row.action === 'trash') groups.trash.push(row.messageId)
    else if (row.action === 'star') groups.star.push(row.messageId)
    // 'keep' → no-op
  }

  const failed: { messageId: string; error: string }[] = []
  let applied = 0
  const byAction: Record<string, number> = {}
  const run = async (fn: BatchFn, ids: string[], label: string): Promise<string | undefined> => {
    if (ids.length === 0) return undefined
    const r = await fn({ messageIds: ids }, { credential: deps.credential })
    if ('error' in r) return r.error
    applied += r.done.length
    failed.push(...r.failed)
    byAction[label] = r.done.length
    return undefined
  }

  const err =
    (await run(markRead, groups.read, 'read')) ??
    (await run(trash, groups.trash, 'trash')) ??
    (await run(star, groups.star, 'star'))
  if (err) return { applied, failed, byAction, error: err }
  return { applied, failed, byAction }
}
