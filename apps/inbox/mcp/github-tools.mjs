// stdio MCP server launched by the `claude` CLI (--mcp-config). READ-ONLY: it shells
// out to `gh` for the GitHub Projects v2 board + issue reads, and exposes render-tool
// acks for generative UI. It contains NO mutating gh call (no `comment`/`edit`/
// `item-edit`) — read-only by construction. The model has no Bash (deny-list in
// claude-spawn.ts), so this adapter is the ONLY path to GitHub.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mapSearchNodes } from './github-format.mjs'

const execFileP = promisify(execFile)

const PROJECT = Number(process.env.GH_PROJECT || '8')
const OWNER = process.env.GH_OWNER || 'matteappen'
const ASSIGNEE = process.env.GH_ASSIGNEE || 'Yaroshuk'
const BODY_MAX = 1500 // get_ticket: a full single-issue read
const COMMENT_MAX = 600
// list_my_tickets is COURIERED through the model (it re-emits every ticket into
// render_triage token-by-token), so keep each ticket small or the run is slow and can
// hit the kill timeout. The triage card shows neither body nor comment text — these
// excerpts only ride along for the downstream handoff payload.
const LIST_BODY_MAX = 400
const LIST_COMMENT_MAX = 240
// Triage only surfaces tickets in these board statuses, capped to the most recent few —
// everything else (Backlog, Done, deployed lanes) is noise for "what needs attention".
const ALLOWED_STATUSES = ['Todo', 'In progress', 'On pluto', 'Ready for mars']
const MAX_TICKETS = 20

const gh = async (args) => {
  const { stdout } = await execFileP('gh', args, { maxBuffer: 32 * 1024 * 1024 })
  return stdout
}

const errText = (err) => err?.stderr?.toString?.() || err?.message || String(err)

// One cheap GraphQL query: search the user's open issues in the org (scoped server-side,
// so we never page the whole board), and for each pull its board Status/Priority + last
// comment inline. `$q` is a GitHub issue-search string. Read-only.
const SEARCH_QUERY = `
query($q: String!) {
  search(query: $q, type: ISSUE, first: 50) {
    nodes {
      ... on Issue {
        number
        title
        body
        url
        repository { nameWithOwner }
        comments(last: 1) { nodes { author { login } body } }
        projectItems(first: 10) {
          nodes {
            project { number }
            status: fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue { name }
            }
            priority: fieldValueByName(name: "Priority") {
              ... on ProjectV2ItemFieldSingleSelectValue { name }
            }
          }
        }
      }
    }
  }
}`

const server = new McpServer({ name: 'github', version: '1.0.0' })

// list_my_tickets — the board read. TRIAGE only. One search query returns the user's open
// issues (scoped to them server-side) with each ticket's status, priority, trimmed body,
// last comment, and a needsReply flag; kept to ALLOWED_STATUSES and capped at MAX_TICKETS.
server.registerTool(
  'list_my_tickets',
  {
    description:
      "List the current user's open tickets on the GitHub project board, each with status, priority, a trimmed body, and the last comment. Read-only.",
    inputSchema: {},
  },
  async () => {
    try {
      const q = `assignee:${ASSIGNEE} org:${OWNER} is:issue is:open`
      const out = await gh(['api', 'graphql', '-f', `query=${SEARCH_QUERY}`, '-f', `q=${q}`])
      const parsed = JSON.parse(out)
      if (parsed.errors) throw new Error(parsed.errors.map((e) => e.message).join('; '))
      const tickets = mapSearchNodes(parsed.data?.search ?? { nodes: [] }, {
        project: PROJECT,
        allowedStatuses: ALLOWED_STATUSES,
        max: MAX_TICKETS,
        assignee: ASSIGNEE,
        bodyMax: LIST_BODY_MAX,
        commentMax: LIST_COMMENT_MAX,
      })
      return { content: [{ type: 'text', text: JSON.stringify({ tickets }) }] }
    } catch (err) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: errText(err) }) }] }
    }
  }
)

// get_ticket — full single-issue read (body + comments). TRIAGE only (downstream
// agents never fetch; they get the ticket via the handoff payload).
server.registerTool(
  'get_ticket',
  {
    description: 'Read one GitHub issue in full (body + comments). Read-only.',
    inputSchema: { repo: z.string(), number: z.number() },
  },
  async ({ repo, number }) => {
    try {
      const out = await gh([
        'issue',
        'view',
        String(number),
        '-R',
        repo,
        '--json',
        'number,title,body,state,comments',
      ])
      // Trim body + comments so a full read can't flood the model context (same
      // bound as list_my_tickets). We keep the last few comments — they carry the
      // current state of the conversation.
      const issue = JSON.parse(out)
      const trimmed = {
        number: issue.number,
        title: issue.title,
        state: issue.state,
        body: (issue.body ?? '').slice(0, BODY_MAX),
        comments: (issue.comments ?? []).slice(-10).map((c) => ({
          author: c.author?.login ?? '',
          body: (c.body ?? '').slice(0, COMMENT_MAX),
        })),
      }
      return { content: [{ type: 'text', text: JSON.stringify(trimmed) }] }
    } catch (err) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: errText(err) }) }] }
    }
  }
)

// Generative-UI render tools — trivial acks; the UI is driven by the provider stream.
const ticketShape = {
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
  body: z.string(),
  url: z.string(),
  lastComment: z.object({ author: z.string(), body: z.string() }).nullable(),
  needsReply: z.boolean(),
  recommendation: z.string(),
}

server.registerTool(
  'render_triage',
  {
    description: 'Surface the triaged ticket list (grouped by status) as a card in the UI.',
    inputSchema: { tickets: z.array(z.object(ticketShape)) },
  },
  async () => ({ content: [{ type: 'text', text: 'Triage surfaced to the user.' }] })
)

server.registerTool(
  'render_ticket_result',
  {
    description: 'Surface a feature/bug analysis of one ticket as a card in the UI.',
    inputSchema: { title: z.string(), kind: z.string(), analysis: z.string() },
  },
  async () => ({ content: [{ type: 'text', text: 'Analysis surfaced to the user.' }] })
)

server.registerTool(
  'render_reply_draft',
  {
    description: 'Surface a suggested reply comment (draft only — never posted) as a card.',
    inputSchema: { title: z.string(), draft: z.string() },
  },
  async () => ({ content: [{ type: 'text', text: 'Suggested reply surfaced to the user.' }] })
)

await server.connect(new StdioServerTransport())
