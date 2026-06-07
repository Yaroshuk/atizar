// Pure transform over the GraphQL `search` result the MCP adapter (github-tools.mjs)
// runs. No I/O, so it is unit-tested. One cheap search query returns the user's open
// issues already scoped to them, each carrying its project Status/Priority and last
// comment — so this just shapes them, keeps only the wanted statuses, trims bodies, and
// caps the count. (We deliberately do NOT scan the whole project board — that paged
// GraphQL pull of ~1785 items burned the hourly point budget.)
//
// `node.projectItems` lists every project the issue sits in; we read Status/Priority
// from the one matching `project` (the board we triage). Issues not on that board, or
// whose status isn't in `allowedStatuses`, are dropped.
export function mapSearchNodes(
  search,
  { project, allowedStatuses, max, assignee, bodyMax = 1500, commentMax = 600 }
) {
  const allowed = new Set(allowedStatuses.map((s) => s.toLowerCase()))
  const me = assignee.toLowerCase()
  const out = []
  for (const n of search.nodes ?? []) {
    const item = (n.projectItems?.nodes ?? []).find((pi) => pi.project?.number === project)
    const status = item?.status?.name ?? ''
    if (!allowed.has(status.toLowerCase())) continue

    const last = n.comments?.nodes?.[0]
    const lastComment = last
      ? { author: last.author?.login ?? '', body: (last.body ?? '').slice(0, commentMax) }
      : null

    out.push({
      repo: n.repository?.nameWithOwner ?? '',
      number: n.number,
      title: n.title ?? '',
      status,
      priority: item?.priority?.name ?? '',
      body: (n.body ?? '').slice(0, bodyMax),
      url: n.url ?? '',
      lastComment,
      needsReply: !!(lastComment && lastComment.author.toLowerCase() !== me),
    })
    if (out.length >= max) break
  }
  return out
}
