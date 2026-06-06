import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import type { Provider } from './providers.js'
import { approvalResolved, type Message } from './messages.js'

const LEAD = { id: 42, from: 'ivan@acme.ru', subject: 'Order: 10 units', intent: 'order' }

function textChunk(delta: string): BaseEvent {
  return {
    type: EventType.TEXT_MESSAGE_CHUNK,
    role: 'assistant',
    messageId: crypto.randomUUID(),
    delta,
  } as BaseEvent
}

async function* toolCall(name: string, args: unknown): AsyncGenerator<BaseEvent> {
  const toolCallId = crypto.randomUUID()
  yield {
    type: EventType.TOOL_CALL_START,
    parentMessageId: crypto.randomUUID(),
    toolCallId,
    toolCallName: name,
  } as BaseEvent
  yield {
    type: EventType.TOOL_CALL_ARGS,
    toolCallId,
    delta: JSON.stringify(args),
  } as BaseEvent
  yield { type: EventType.TOOL_CALL_END, toolCallId } as BaseEvent
}

// The fake "model": on turn 1 it streams text → a renderLead tool call → a
// confirmSend approval; on resume (the approval has been answered) it emits the
// done text. `approvalNames` comes from the agent definition, not a hardcode.
export function createMockInboxProvider(approvalNames: readonly string[]): Provider {
  return {
    async *run(runInput: RunAgentInput): AsyncIterable<BaseEvent> {
      const messages = (runInput?.messages ?? []) as Message[]

      if (approvalResolved(messages, approvalNames)) {
        yield textChunk('Done — reply sent.')
        return
      }

      yield textChunk('Checking inbox… found a lead.')
      yield* toolCall('renderLead', LEAD)
      yield* toolCall('confirmSend', { leadId: LEAD.id, message: 'Send a reply to this lead?' })
    },
  }
}
