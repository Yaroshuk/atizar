import { fileURLToPath } from 'node:url'
import { makeClaudeSpawn } from '@atizar/server'
import type { ClaudeSpawn } from '@atizar/providers'

// Absolute path to the stdio MCP server scripts.
const MCP_SERVER = fileURLToPath(new URL('../mcp/inbox-tools.mjs', import.meta.url))
// The gmail MCP server is a `.mts` file (it imports `@atizar/server` for resolveCredential,
// which is `.ts` source) → spawned via the tsx loader: `node --import tsx <path>`.
const GMAIL_SERVER = fileURLToPath(new URL('../mcp/gmail-tools.mts', import.meta.url))

// Built-in tools the model must not use — only our MCP tools are allowed.
const BUILTINS = ['Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch']

// A whole run shouldn't outlive a human-scale interaction; kill stuck processes.
// A sorter scan over a full inbox plus the batch cards is token-heavy, so give the
// model headroom beyond the original 120s before we consider it stuck.
const RUN_TIMEOUT_MS = 180_000

// Concrete claude spawn for the inbox app. The generic engine lives in @atizar/server; the
// app injects the MCP server paths, the builtins deny-list, the timeout, and the env policy.
//
// ENV POLICY (DO NOT WEAKEN): the child inherits the FULL process env (spread), so the
// framework's ATIZAR_* vars — ATIZAR_SECRET_KEY / ATIZAR_DATABASE_URL / ATIZAR_CONNECTION /
// ATIZAR_<PROVIDER>_CLIENT_* — flow through to the spawned MCP servers automatically; that is
// REQUIRED so an MCP child can `resolveCredential` against the same encrypted store. Do NOT
// switch to an allow-list of env keys without also forwarding the ATIZAR_* set, or credential
// resolution in MCP children breaks SILENTLY. ANTHROPIC_API_KEY is the one deliberate removal
// (subscription auth — see browser-verify).
export const claudeSpawn: ClaudeSpawn = makeClaudeSpawn({
  mcpServers: {
    inbox: { type: 'stdio', command: 'node', args: [MCP_SERVER] },
    gmail: { type: 'stdio', command: 'node', args: ['--import', 'tsx', GMAIL_SERVER] },
  },
  builtins: BUILTINS,
  timeoutMs: RUN_TIMEOUT_MS,
  prepareEnv: (base) => {
    const env = { ...base }
    delete env.ANTHROPIC_API_KEY
    return env
  },
})
