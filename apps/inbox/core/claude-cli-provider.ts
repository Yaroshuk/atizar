import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import type { Provider } from './providers.js'
import { approvalResolved, type Message } from './messages.js'
import { mapClaudeStream } from './claude-stream.js'

// The canned lead — placeholder for real Gmail data (next phase).
const LEAD = { id: 42, from: 'ivan@acme.ru', subject: 'Order: 10 units', intent: 'order' }

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
    `Inbox (one new email): ${JSON.stringify(LEAD)}`,
    '',
    'Call renderLead with that email to surface it to the user, then call',
    'confirmSend with { leadId, message } to ask the human before replying.',
    'Do not send anything yourself.',
  ].join('\n')
}

function resumePrompt(instructions: string): string {
  return [
    instructions,
    '',
    `You surfaced this lead: ${JSON.stringify(LEAD)} and asked the human to`,
    'confirm sending a reply. The human APPROVED. Reply with one short sentence',
    'confirming the reply was sent. Do not call any tools.',
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
  instructions: string
  spawn: ClaudeSpawn
}): Provider {
  const { approvalNames, instructions, spawn } = opts
  return {
    async *run(input: RunAgentInput): AsyncIterable<BaseEvent> {
      const messages = (input?.messages ?? []) as Message[]
      const resuming = approvalResolved(messages, approvalNames)
      let child: { lines: AsyncIterable<string>; kill: () => void } | undefined
      try {
        child = spawn(resuming ? resumePrompt(instructions) : firstPrompt(instructions))
      } catch (err) {
        yield errorChunk(err instanceof Error ? err.message : String(err))
        return
      }
      try {
        yield* mapClaudeStream(child.lines, { approvalNames: resuming ? [] : approvalNames })
      } catch (err) {
        yield errorChunk(err instanceof Error ? err.message : String(err))
      } finally {
        child.kill()
      }
    },
  }
}
