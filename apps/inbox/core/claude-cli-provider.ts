import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import type { Provider } from './providers.js'
import { approvalResolved, lastApprovalArgs, type Message } from './messages.js'
import { mapClaudeStream } from './claude-stream.js'

// Spawns a `claude` run for a prompt and exposes stdout as NDJSON lines + kill().
// Injectable so the Node implementation stays server-side and tests use a fake.
export type ClaudeSpawn = (prompt: string) => {
  lines: AsyncIterable<string>
  kill: () => void
}

function firstPrompt(instructions: string): string {
  return [
    instructions,
    '',
    'Call get_latest_email to read the single most recent email in the inbox',
    '(it returns { threadId, from, subject, body }). Then call renderLead with',
    '{ from, subject, summary } to surface it, and draft a short reply.',
    'Then call saveDraft with { threadId, body } — threadId from the email, body',
    'is your drafted reply — to ask the human before saving.',
    'Do NOT create the draft yet and do NOT send anything. Do not narrate your',
    'tool usage or mention tools/schemas — keep any text brief and user-facing.',
  ].join('\n')
}

function resumePrompt(instructions: string, threadId: string, body: string): string {
  return [
    instructions,
    '',
    `The human APPROVED saving this reply. Create it as a Gmail DRAFT now by`,
    `calling create_draft, replying within thread "${threadId}", with this body:`,
    '',
    body,
    '',
    'Do not send. After the draft is created, reply with one short sentence',
    'confirming the draft was saved to Gmail. Do not narrate tool usage.',
  ].join('\n')
}

function errorChunk(message: string): BaseEvent {
  return {
    type: EventType.TEXT_MESSAGE_CHUNK,
    role: 'assistant',
    messageId: crypto.randomUUID(),
    delta: `Provider error: ${message}`,
  } as BaseEvent
}

export function createClaudeCliProvider(opts: {
  approvalNames: readonly string[]
  // The agent's renderable tool names — only these surface to the client; the
  // model's internal tools (e.g. ToolSearch) are filtered out of the thread.
  surfaceTools: readonly string[]
  instructions: string
  spawn: ClaudeSpawn
}): Provider {
  const { approvalNames, surfaceTools, instructions, spawn } = opts
  return {
    async *run(input: RunAgentInput): AsyncIterable<BaseEvent> {
      const messages = (input?.messages ?? []) as Message[]
      const resuming = approvalResolved(messages, approvalNames)
      let child: { lines: AsyncIterable<string>; kill: () => void } | undefined
      try {
        let prompt: string
        if (resuming) {
          const args = lastApprovalArgs(messages, approvalNames)
          const threadId = typeof args?.threadId === 'string' ? args.threadId : ''
          const body = typeof args?.body === 'string' ? args.body : ''
          if (!threadId || !body) {
            yield errorChunk('Resume failed: no saved draft found in the thread')
            return
          }
          prompt = resumePrompt(instructions, threadId, body)
        } else {
          prompt = firstPrompt(instructions)
        }
        child = spawn(prompt)
      } catch (err) {
        yield errorChunk(err instanceof Error ? err.message : String(err))
        return
      }
      try {
        yield* mapClaudeStream(child.lines, { approvalNames: resuming ? [] : approvalNames, surfaceTools })
      } catch (err) {
        yield errorChunk(err instanceof Error ? err.message : String(err))
      } finally {
        child.kill()
      }
    },
  }
}
