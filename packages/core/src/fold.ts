import { EventType, type BaseEvent } from '@ag-ui/client'
import type { AssistantMessage, Message, ToolCall, ToolMessage } from './messages.js'
import { LIFECYCLE_NOTE_TEXT, type LifecycleNoteValue } from './lifecycleNote.js'

// Fold a stream of AG-UI events into the Message[] the thread renders. This is the
// reduction CopilotKit's runtime did internally; with the `@copilotkit/*` transport
// dropped (pipeline-updated-3 decision 6) the server's Trace is the source and the
// client folds it here. Pure & isomorphic (no React, no Node) so the same function
// serves the live SSE tail, a `?from=seq` snapshot, and a reopened thread.
//
// Folding is a left fold: `foldEventsToMessages(events)` and
// `foldEventsToMessages(events.slice(0, k))` agree on their common prefix, so a viewer
// can re-fold the whole trace on every SSE delta without special-casing the tail.
//
// Events handled (exactly what claude-stream / the mock emit):
//   TEXT_MESSAGE_CHUNK  → assistant bubble keyed by messageId; deltas concatenated.
//   TOOL_CALL_START     → assistant message keyed by parentMessageId, with one tool call.
//   TOOL_CALL_ARGS      → appended to that tool call's `function.arguments`.
//   TOOL_CALL_END       → no-op for message shape (boundary marker only).
//   TOOL_CALL_RESULT    → a role:"tool" message (paired later via pairToolResults).
// Anything else (e.g. the GATE_OPENED CUSTOM signal) is not a message and is skipped.
export function foldEventsToMessages(events: readonly BaseEvent[]): Message[] {
  // Insertion-ordered: a Map preserves first-seen order, which is chronological because
  // every message id (text messageId, tool parentMessageId, result messageId) is unique
  // and first appears at its position in the stream.
  const byId = new Map<string, Message>()
  // Route TOOL_CALL_ARGS back to the assistant message that owns the call.
  const messageIdByToolCallId = new Map<string, string>()

  for (const event of events) {
    const e = event as BaseEvent & {
      messageId?: string
      delta?: string
      parentMessageId?: string
      toolCallId?: string
      toolCallName?: string
      content?: string
    }

    switch (e.type) {
      case EventType.TEXT_MESSAGE_CHUNK: {
        const id = e.messageId
        if (!id) break
        const existing = byId.get(id)
        if (existing && existing.role === 'assistant') {
          existing.content = (existing.content ?? '') + (e.delta ?? '')
        } else {
          byId.set(id, { id, role: 'assistant', content: e.delta ?? '' } as AssistantMessage)
        }
        break
      }

      case EventType.TOOL_CALL_START: {
        const callId = e.toolCallId
        if (!callId) break
        // claude-stream mints a fresh parentMessageId per tool call, so each call is its
        // own assistant message — fall back to the callId if it is ever absent.
        const msgId = e.parentMessageId ?? `tc-${callId}`
        let msg = byId.get(msgId) as AssistantMessage | undefined
        if (!msg || msg.role !== 'assistant') {
          msg = { id: msgId, role: 'assistant', content: '', toolCalls: [] } as AssistantMessage
          byId.set(msgId, msg)
        }
        if (!msg.toolCalls) msg.toolCalls = []
        const call: ToolCall = {
          id: callId,
          type: 'function',
          function: { name: e.toolCallName ?? '', arguments: '' },
        }
        msg.toolCalls.push(call)
        messageIdByToolCallId.set(callId, msgId)
        break
      }

      case EventType.TOOL_CALL_ARGS: {
        const callId = e.toolCallId
        if (!callId) break
        const msgId = messageIdByToolCallId.get(callId)
        if (!msgId) break
        const msg = byId.get(msgId) as AssistantMessage | undefined
        const call = msg?.toolCalls?.find((c) => c.id === callId)
        if (call) call.function.arguments += e.delta ?? ''
        break
      }

      case EventType.TOOL_CALL_END:
        break // boundary marker only

      case EventType.TOOL_CALL_RESULT: {
        const callId = e.toolCallId
        const id = e.messageId ?? (callId ? `result-${callId}` : undefined)
        if (!id || !callId) break
        byId.set(id, {
          id,
          role: 'tool',
          toolCallId: callId,
          content: e.content ?? '',
        } as ToolMessage)
        break
      }

      case EventType.CUSTOM: {
        // A server-authored note (I14). Only the typed 'lifecycle' note becomes a message; other
        // CUSTOM events (e.g. dispatch_rejected) stay non-message, as before.
        const named = event as BaseEvent & { name?: string; value?: LifecycleNoteValue }
        if (named.name !== 'lifecycle' || !named.value) break
        const text = LIFECYCLE_NOTE_TEXT[named.value.outcome] || named.value.outcome
        const id = `lifecycle-${named.value.at}`
        byId.set(id, { id, role: 'system', content: text } as Message)
        break
      }

      default:
        break // not a message-bearing event (e.g. GATE_OPENED)
    }
  }

  return [...byId.values()]
}
