import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import type { Provider, PromptStrategy } from './providers.js'
import { approvalResolved, lastApprovalArgs, type Message } from './messages.js'
import { mapClaudeStream } from './claude-stream.js'

// Spawns a `claude` run for a prompt and exposes stdout as NDJSON lines + kill().
// `allowedTools` is the agent's permission allow-list (fully-qualified MCP names) —
// the hard per-agent boundary on which tools the model may call. Injectable so the
// Node implementation stays server-side and tests use a fake.
export type ClaudeSpawn = (
  prompt: string,
  allowedTools: readonly string[]
) => {
  lines: AsyncIterable<string>
  kill: () => void
}

function errorChunk(message: string): BaseEvent {
  return {
    type: EventType.TEXT_MESSAGE_CHUNK,
    role: 'assistant',
    messageId: crypto.randomUUID(),
    delta: `Provider error: ${message}`,
  } as BaseEvent
}

// Generic over the agent: prompts come from an injected PromptStrategy, so the same
// provider serves the reply agent, the qualifier, and any future claude-cli agent.
export function createClaudeCliProvider(opts: {
  approvalNames: readonly string[]
  // The agent's renderable tool names — only these surface to the client; the
  // model's internal tools (e.g. ToolSearch) are filtered out of the thread.
  surfaceTools: readonly string[]
  // The agent's permission allow-list (fully-qualified MCP names) — passed to spawn.
  allowedTools: readonly string[]
  prompts: PromptStrategy
  spawn: ClaudeSpawn
}): Provider {
  const { approvalNames, surfaceTools, allowedTools, prompts, spawn } = opts
  return {
    async *run(input: RunAgentInput): AsyncIterable<BaseEvent> {
      const messages = (input?.messages ?? []) as Message[]
      const resuming = approvalResolved(messages, approvalNames)
      let child: { lines: AsyncIterable<string>; kill: () => void } | undefined
      try {
        let prompt: string
        if (resuming) {
          const args = lastApprovalArgs(messages, approvalNames) ?? {}
          const resumePrompt = prompts.buildResume?.(args) ?? null
          if (!resumePrompt) {
            yield errorChunk('Resume failed: no saved draft found in the thread')
            return
          }
          prompt = resumePrompt
        } else {
          prompt = prompts.buildFirst(input)
        }
        child = spawn(prompt, allowedTools)
      } catch (err) {
        yield errorChunk(err instanceof Error ? err.message : String(err))
        return
      }
      try {
        yield* mapClaudeStream(child.lines, {
          approvalNames: resuming ? [] : approvalNames,
          surfaceTools,
        })
      } catch (err) {
        yield errorChunk(err instanceof Error ? err.message : String(err))
      } finally {
        child.kill()
      }
    },
  }
}
