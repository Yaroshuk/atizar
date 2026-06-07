// Pure transforms over `gh project item-list --format json` output. No I/O, so it is
// unit-tested; the MCP adapter (github-tools.mjs) does the gh shelling + comment
// enrichment around this. Scopes to one assignee, drops draft items (no issue number)
// and excluded statuses, and trims bodies so the couriered handoff stays bounded.
export function mapItems(itemList, { assignee, excludeStatuses = [], bodyMax = 1500 }) {
  // Compare statuses case-insensitively, like the assignee match — the `gh` Status
  // field is title-case ("In progress", "Done") but callers shouldn't depend on that.
  const exclude = new Set(excludeStatuses.map((s) => s.toLowerCase()))
  const me = assignee.toLowerCase()
  return (itemList.items ?? [])
    .filter((it) => (it.assignees ?? []).some((a) => a.toLowerCase() === me))
    .filter((it) => !exclude.has((it.status ?? '').toLowerCase()))
    .filter((it) => typeof it.content?.number === 'number')
    .map((it) => ({
      repo: it.content.repository ?? '',
      number: it.content.number,
      title: it.content.title ?? '',
      status: it.status ?? '',
      priority: it.priority ?? '',
      body: (it.content.body ?? '').slice(0, bodyMax),
      url: it.content.url ?? '',
      lastComment: null,
      needsReply: false,
    }))
}
