// stdio MCP server launched by the `claude` CLI (--mcp-config). Exposes two
// Gmail tools so the model can read the latest inbox email and create a draft
// reply. Uses googleapis with an OAuth2 client + token stored on disk at
// ~/.gmail-mcp/ (paths overridable via env vars). No network calls are
// unit-tested here — live verification happens in the e2e spike (Task 6e).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { google } from 'googleapis'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { parseLatestMessage, buildReplyRaw } from './gmail-format.mjs'

// ---------------------------------------------------------------------------
// Auth setup
// ---------------------------------------------------------------------------

const keysPath =
  process.env.GMAIL_OAUTH_KEYS || join(homedir(), '.gmail-mcp', 'gcp-oauth.keys.json')
const credsPath =
  process.env.GMAIL_OAUTH_CREDENTIALS || join(homedir(), '.gmail-mcp', 'credentials.json')

const keys = JSON.parse(readFileSync(keysPath, 'utf8'))
const clientData = keys.installed || keys.web
const { client_id, client_secret } = clientData
const redirectUri = clientData.redirect_uris?.[0] ?? 'http://localhost:3000/oauth2callback'

const auth = new google.auth.OAuth2(client_id, client_secret, redirectUri)
const storedCreds = JSON.parse(readFileSync(credsPath, 'utf8'))
auth.setCredentials(storedCreds)
// googleapis auto-refreshes using refresh_token when the access token is expired.

const gmail = google.gmail({ version: 'v1', auth })

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const server = new McpServer({ name: 'gmail', version: '1.0.0' })

// Tool: get_latest_email
// Fetches the most-recent message from the inbox and returns structured fields.
server.registerTool(
  'get_latest_email',
  {
    description: 'Fetch the most-recent email from the Gmail inbox and return its parsed fields.',
    inputSchema: {},
  },
  async () => {
    try {
      const list = await gmail.users.messages.list({ userId: 'me', q: 'in:inbox', maxResults: 1 })
      if (!list.data.messages?.length) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'No emails found in inbox.' }) }] }
      }
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: list.data.messages[0].id,
        format: 'full',
      })
      const parsed = parseLatestMessage(full.data)
      return { content: [{ type: 'text', text: JSON.stringify(parsed) }] }
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: String(err?.message || err) }) }],
      }
    }
  },
)

// Tool: create_draft
// Creates a Gmail draft reply to the given thread. NEVER sends. The caller
// must supply threadId (from get_latest_email) and the reply body text.
server.registerTool(
  'create_draft',
  {
    description:
      'Create a Gmail draft reply for the given thread. Does NOT send — draft only.',
    inputSchema: { threadId: z.string(), body: z.string() },
  },
  async ({ threadId, body }) => {
    try {
      // Fetch thread metadata to derive To + Subject from the last message.
      const thread = await gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject'],
      })

      const messages = thread.data.messages ?? []
      const lastMsg = messages[messages.length - 1]
      const headers = lastMsg?.payload?.headers ?? []

      const findHeader = (name) => {
        const lower = name.toLowerCase()
        return headers.find((h) => h.name.toLowerCase() === lower)?.value ?? ''
      }

      const to = findHeader('From')
      const subject = findHeader('Subject')

      const raw = buildReplyRaw({ to, subject, body, threadId })

      const draft = await gmail.users.drafts.create({
        userId: 'me',
        requestBody: { message: { raw, threadId } },
      })

      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, draftId: draft.data.id }) }],
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: String(err?.message || err) }) }],
      }
    }
  },
)

await server.connect(new StdioServerTransport())
