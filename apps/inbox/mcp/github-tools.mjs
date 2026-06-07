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
import { mapItems } from './github-format.mjs'

const execFileP = promisify(execFile)

const PROJECT = process.env.GH_PROJECT || '8'
const OWNER = process.env.GH_OWNER || 'matteappen'
const ASSIGNEE = process.env.GH_ASSIGNEE || 'Yaroshuk'
const BODY_MAX = 1500
const COMMENT_MAX = 600

const gh = async (args) => {
  const { stdout } = await execFileP('gh', args, { maxBuffer: 32 * 1024 * 1024 })
  return stdout
}

const errText = (err) => err?.stderr?.toString?.() || err?.message || String(err)

// Read the last comment of one issue (author + trimmed body), or null.
async function lastComment(repo, number) {
  try {
    const out = await gh(['issue', 'view', String(number), '-R', repo, '--json', 'comments'])
    const comments = JSON.parse(out).comments ?? []
    if (!comments.length) return null
    const last = comments[comments.length - 1]
    return { author: last.author?.login ?? '', body: (last.body ?? '').slice(0, COMMENT_MAX) }
  } catch {
    return null // a single unreadable issue must not fail the whole list
  }
}

const server = new McpServer({ name: 'github', version: '1.0.0' })

// list_my_tickets — the board read. TRIAGE only. Scopes to ASSIGNEE, excludes Done,
// enriches each ticket with its last comment + a needsReply flag (someone other than
// me commented last). Returns { tickets: [...] }.
server.registerTool(
  'list_my_tickets',
  {
    description:
      "List the current user's open tickets on the GitHub project board (excludes Done), each with status, priority, a trimmed body, and the last comment. Read-only.",
    inputSchema: {},
  },
  async () => {
    try {
      const out = await gh([
        'project',
        'item-list',
        PROJECT,
        '--owner',
        OWNER,
        '--format',
        'json',
        '--limit',
        '2000',
      ])
      const tickets = mapItems(JSON.parse(out), {
        assignee: ASSIGNEE,
        excludeStatuses: ['Done'],
        bodyMax: BODY_MAX,
      })
      for (const t of tickets) {
        t.lastComment = await lastComment(t.repo, t.number)
        t.needsReply = !!(
          t.lastComment && t.lastComment.author.toLowerCase() !== ASSIGNEE.toLowerCase()
        )
      }
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
