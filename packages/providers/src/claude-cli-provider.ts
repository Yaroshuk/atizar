import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import {
  approvalResolved,
  lastApprovalArgs,
  type GateResolution,
  type Provider,
  type PromptStrategy,
  type ResumeHandle,
  type Message,
} from '@atizar/core'
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

function textChunk(message: string): BaseEvent {
  return {
    type: EventType.TEXT_MESSAGE_CHUNK,
    role: 'assistant',
    messageId: crypto.randomUUID(),
    delta: message,
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

  // Spawn the CLI for a prompt and map its NDJSON to AG-UI events. `detectApprovals` is the
  // approval-name set the stream watches for the GATE_OPENED suspend point — passed [] on a
  // resume run (a resumed run must not re-open the same gate).
  async function* primeAndStream(
    prompt: string,
    detectApprovals: readonly string[]
  ): AsyncGenerator<BaseEvent> {
    let child: { lines: AsyncIterable<string>; kill: () => void }
    try {
      child = spawn(prompt, allowedTools)
    } catch (err) {
      yield errorChunk(err instanceof Error ? err.message : String(err))
      return
    }
    try {
      yield* mapClaudeStream(child.lines, { approvalNames: detectApprovals, surfaceTools })
    } catch (err) {
      yield errorChunk(err instanceof Error ? err.message : String(err))
    } finally {
      child.kill()
    }
  }

  // Build the resume prompt from the approved/edited artifact (resolution.form), falling back
  // to the last approval args in the transcript. Returns null when no usable draft exists.
  // Precedence is `??` (not `||`) on purpose: an explicitly-passed `form` is honored even when
  // empty `{}` — the caller's decision wins over the transcript — and an empty form then yields
  // a null prompt (buildResume rejects it), surfacing "Resume failed" rather than silently
  // re-priming from a stale transcript. Do not change `??` to `||`.
  function resumePromptFrom(handle: ResumeHandle, resolution: GateResolution): string | null {
    const messages = (handle.input?.messages ?? []) as Message[]
    const args = resolution.form ?? lastApprovalArgs(messages, approvalNames) ?? {}
    return prompts.buildResume?.(args, resolution.executedResult) ?? null
  }

  return {
    async *run(input: RunAgentInput): AsyncIterable<BaseEvent> {
      const messages = (input?.messages ?? []) as Message[]
      const resuming = approvalResolved(messages, approvalNames)
      if (resuming) {
        // Legacy stateless re-prime: the old client drives resume through run() with the
        // resolved transcript and NO resolution.form, so this reads args from the transcript
        // only. The explicit resume() path (below) prefers resolution.form via resumePromptFrom.
        const args = lastApprovalArgs(messages, approvalNames) ?? {}
        const resumePrompt = prompts.buildResume?.(args) ?? null
        if (!resumePrompt) {
          yield errorChunk('Resume failed: no saved draft found in the thread')
          return
        }
        yield* primeAndStream(resumePrompt, [])
        return
      }
      yield* primeAndStream(prompts.buildFirst(input), approvalNames)
    },

    async *resume(handle: ResumeHandle, resolution: GateResolution): AsyncIterable<BaseEvent> {
      if (resolution.decision === 'rejected') {
        yield textChunk('The human rejected the proposed action; no changes were made.')
        return
      }
      const resumePrompt = resumePromptFrom(handle, resolution)
      if (!resumePrompt) {
        yield errorChunk('Resume failed: no saved draft found in the thread')
        return
      }
      yield* primeAndStream(resumePrompt, [])
    },
  }
}
