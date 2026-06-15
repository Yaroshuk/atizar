import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { makeClaudeSpawn } from './makeClaudeSpawn.js'

describe('makeClaudeSpawn', () => {
  it('writes an mcp-config with the given servers and a settings allow/deny list', async () => {
    let writtenMcp = ''
    let writtenSettings = ''
    const spawn = makeClaudeSpawn({
      command: '/bin/true',
      mcpServers: { inbox: { type: 'stdio', command: 'node', args: ['/x/inbox.mjs'] } },
      builtins: ['Bash', 'Write'],
      timeoutMs: 1000,
      prepareEnv: (base) => {
        const env = { ...base }
        delete env.SECRET_OVERRIDE
        return env
      },
      onConfigWritten: (mcpPath, settingsPath) => {
        writtenMcp = readFileSync(mcpPath, 'utf8')
        writtenSettings = readFileSync(settingsPath, 'utf8')
      },
    })
    const handle = spawn('do it', ['mcp__inbox__list_unread'])
    const mcp = JSON.parse(writtenMcp)
    expect(mcp.mcpServers.inbox).toEqual({
      type: 'stdio',
      command: 'node',
      args: ['/x/inbox.mjs'],
    })
    const settings = JSON.parse(writtenSettings)
    expect(settings.permissions.allow).toEqual(['mcp__inbox__list_unread'])
    expect(settings.permissions.deny).toEqual(['Bash', 'Write'])
    // Drain the line iterator so the temp dir is cleaned up (the run against /bin/true ends fast).
    for await (const _line of handle.lines) void _line
    handle.kill()
  })
})
