import { spawn as nodeSpawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { createInterface } from 'node:readline'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeSpawn } from '@atizar/providers'

// The mcp-config server entry shape `claude --mcp-config` expects (stdio servers).
export interface McpServerSpec {
  type: 'stdio'
  command: string
  args: string[]
}

export interface ClaudeSpawnOptions {
  // The concrete MCP servers (paths resolved by the caller in the app).
  mcpServers: Record<string, McpServerSpec>
  // Built-in tools to deny (the model uses only the MCP tools we allow).
  builtins: string[]
  // Kill a run that outlives a human-scale interaction.
  timeoutMs: number
  // Build the child env from the parent's. The app forwards the full process env (so ATIZAR_*
  // credential vars flow to MCP children) and deletes ANTHROPIC_API_KEY (subscription auth).
  prepareEnv: (base: NodeJS.ProcessEnv) => NodeJS.ProcessEnv
  // Override the spawned binary (default 'claude'); the test points it at a fast-exiting command.
  command?: string
  // Test-only hook fired right after the two temp config files are written (before spawn).
  onConfigWritten?: (mcpConfigPath: string, settingsPath: string) => void
}

// Yields stdout lines, and — so the provider never silently ends on a broken run —
// appends a synthetic `result` error line (which the parser surfaces as text) when
// the process fails to spawn or times out.
async function* readLines(
  child: ChildProcessByStdio<null, Readable, Readable>,
  onDone: () => void,
  timeoutMs: number
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
  }, timeoutMs)
  try {
    for await (const line of createInterface({ input: child.stdout })) yield line
  } finally {
    clearTimeout(timer)
    onDone()
  }
  if (timedOut) {
    yield JSON.stringify({ type: 'result', is_error: true, result: 'claude run timed out' })
  } else if (spawnError) {
    yield JSON.stringify({
      type: 'result',
      is_error: true,
      result: (spawnError as Error).message,
    })
  }
}

// Builds a ClaudeSpawn: writes a temp mcp-config + permission settings, runs `claude` in
// stream-json mode, exposes stdout as an async line iterator. The caller injects the concrete
// MCP server paths, the builtins deny-list, the timeout, and the env policy (prepareEnv).
export function makeClaudeSpawn(opts: ClaudeSpawnOptions): ClaudeSpawn {
  const binary = opts.command ?? 'claude'
  return (prompt, allowedTools) => {
    const dir = mkdtempSync(join(tmpdir(), 'atizar-claude-'))
    const mcpConfig = join(dir, 'mcp.json')
    const settings = join(dir, 'settings.json')
    writeFileSync(mcpConfig, JSON.stringify({ mcpServers: opts.mcpServers }))
    writeFileSync(
      settings,
      JSON.stringify({
        permissions: {
          allow: [...allowedTools],
          deny: opts.builtins,
        },
      })
    )
    opts.onConfigWritten?.(mcpConfig, settings)

    const env = opts.prepareEnv({ ...process.env })

    const child = nodeSpawn(
      binary,
      [
        // NB: do NOT pass --bare — it skips keychain reads, which breaks the
        // subscription (OAuth-in-keychain) auth and yields "Not logged in".
        '-p',
        prompt,
        '--mcp-config',
        mcpConfig,
        '--strict-mcp-config',
        '--disallowed-tools',
        ...opts.builtins,
        '--settings',
        settings,
        '--output-format',
        'stream-json',
        '--verbose',
        '--include-partial-messages',
      ],
      { env, stdio: ['ignore', 'pipe', 'pipe'] }
    )

    const cleanup = () => {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // best effort
      }
    }

    return {
      lines: readLines(child, cleanup, opts.timeoutMs),
      kill: () => {
        try {
          child.kill('SIGKILL')
        } catch {
          // already gone
        }
      },
    }
  }
}
