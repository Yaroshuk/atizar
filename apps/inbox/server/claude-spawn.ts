import { spawn as nodeSpawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { createInterface } from 'node:readline'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ClaudeSpawn } from '../core/claude-cli-provider.js'

// Absolute path to the stdio MCP server scripts.
const MCP_SERVER = fileURLToPath(new URL('../mcp/inbox-tools.mjs', import.meta.url))
const GMAIL_SERVER = fileURLToPath(new URL('../mcp/gmail-tools.mjs', import.meta.url))

// Built-in tools the model must not use — only our two MCP tools are allowed.
const BUILTINS = ['Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch']

// A whole run shouldn't outlive a human-scale interaction; kill stuck processes.
const RUN_TIMEOUT_MS = 120_000

// Yields stdout lines, and — so the provider never silently ends on a broken run —
// appends a synthetic `result` error line (which the parser surfaces as text) when
// the process fails to spawn or times out.
async function* readLines(
  child: ChildProcessByStdio<null, Readable, Readable>,
  onDone: () => void,
): AsyncGenerator<string> {
  let spawnError: Error | null = null
  let timedOut = false
  child.on('error', (err) => {
    spawnError = err
  })
  const timer = setTimeout(() => {
    timedOut = true
    try {
      child.kill('SIGKILL')
    } catch {
      // already gone
    }
  }, RUN_TIMEOUT_MS)
  try {
    for await (const line of createInterface({ input: child.stdout })) yield line
  } finally {
    clearTimeout(timer)
    onDone()
  }
  if (timedOut) {
    yield JSON.stringify({ type: 'result', is_error: true, result: 'claude run timed out' })
  } else if (spawnError) {
    yield JSON.stringify({ type: 'result', is_error: true, result: (spawnError as Error).message })
  }
}

// Real spawn: writes a temp mcp-config + permission settings, runs `claude` in
// stream-json mode, exposes stdout as an async line iterator. Auth = the Claude
// Code subscription login; ANTHROPIC_API_KEY is removed so it can't override.
export const claudeSpawn: ClaudeSpawn = (prompt) => {
  const dir = mkdtempSync(join(tmpdir(), 'inbox-claude-'))
  const mcpConfig = join(dir, 'mcp.json')
  const settings = join(dir, 'settings.json')
  writeFileSync(
    mcpConfig,
    JSON.stringify({
      mcpServers: {
        inbox: { type: 'stdio', command: 'node', args: [MCP_SERVER] },
        gmail: { type: 'stdio', command: 'node', args: [GMAIL_SERVER] },
      },
    }),
  )
  writeFileSync(
    settings,
    JSON.stringify({
      permissions: {
        allow: [
          'mcp__inbox__renderLead',
          'mcp__inbox__confirmSend',
          'mcp__gmail__get_latest_email',
          'mcp__gmail__create_draft',
        ],
        deny: BUILTINS,
      },
    }),
  )

  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY

  const child = nodeSpawn(
    'claude',
    [
      // NB: do NOT pass --bare — it skips keychain reads, which breaks the
      // subscription (OAuth-in-keychain) auth and yields "Not logged in".
      '-p',
      prompt,
      '--mcp-config',
      mcpConfig,
      '--strict-mcp-config',
      '--disallowed-tools',
      ...BUILTINS,
      '--settings',
      settings,
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
    ],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  )

  // Remove the temp config dir once the run ends (success, kill, or error).
  const cleanup = () => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // best effort
    }
  }

  return {
    lines: readLines(child, cleanup),
    kill: () => {
      try {
        child.kill('SIGKILL')
      } catch {
        // already gone
      }
    },
  }
}
