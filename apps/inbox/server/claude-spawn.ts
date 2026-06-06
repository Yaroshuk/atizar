import { spawn as nodeSpawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ClaudeSpawn } from '../core/claude-cli-provider.js'

// Absolute path to the stdio MCP server script.
const MCP_SERVER = fileURLToPath(new URL('../mcp/inbox-tools.mjs', import.meta.url))

// Real spawn: writes a temp mcp-config + permission settings, runs `claude` in
// stream-json mode, exposes stdout as an async line iterator. Auth = the Claude
// Code subscription login; ANTHROPIC_API_KEY is removed so it can't override.
export const claudeSpawn: ClaudeSpawn = (prompt) => {
  const dir = mkdtempSync(join(tmpdir(), 'inbox-claude-'))
  const mcpConfig = join(dir, 'mcp.json')
  const settings = join(dir, 'settings.json')
  writeFileSync(
    mcpConfig,
    JSON.stringify({ mcpServers: { inbox: { type: 'stdio', command: 'node', args: [MCP_SERVER] } } }),
  )
  writeFileSync(
    settings,
    JSON.stringify({
      permissions: {
        allow: ['mcp__inbox__renderLead', 'mcp__inbox__confirmSend'],
        deny: ['Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'],
      },
    }),
  )

  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY

  const child = nodeSpawn(
    'claude',
    [
      '--bare',
      '-p',
      prompt,
      '--mcp-config',
      mcpConfig,
      '--strict-mcp-config',
      '--settings',
      settings,
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
    ],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  )

  const rl = createInterface({ input: child.stdout! })
  return {
    lines: rl,
    kill: () => {
      try {
        child.kill('SIGKILL')
      } catch {
        // already gone
      }
    },
  }
}
