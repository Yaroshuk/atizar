import { EventType, type BaseEvent } from '@ag-ui/client'

// Claude Code MCP tools surface as `mcp__<server>__<tool>`; the client registered
// the bare names (`renderLead`, `saveDraft`), so strip the prefix.
function stripMcpPrefix(name: string): string {
  if (!name.startsWith('mcp__')) return name
  const rest = name.slice('mcp__'.length)
  const sep = rest.indexOf('__')
  return sep === -1 ? name : rest.slice(sep + 2)
}

function textChunk(text: string): BaseEvent {
  return {
    type: EventType.TEXT_MESSAGE_CHUNK,
    role: 'assistant',
    messageId: crypto.randomUUID(),
    delta: text,
  } as BaseEvent
}

type ToolBlock = { id: string; name: string; sawArgs: boolean; startInput: unknown }

// Parses the `claude --output-format stream-json` NDJSON stream into AG-UI events.
//
// Claude emits a turn in TWO overlapping shapes: incremental `stream_event` lines
// (content_block_start/delta/stop, with `--include-partial-messages`) AND a final
// complete top-level `{ type: 'assistant', message }` line. Synthetic/cached turns
// (and short responses) may arrive ONLY as the complete top-level message with no
// partial deltas. We handle both and de-duplicate: text is emitted from deltas when
// streaming, else from the complete message; tool calls are de-duped by id.
//
// Stops (returns) right after emitting TOOL_CALL_END for an approval tool — the
// caller then kills the subprocess (turn-1 HITL pause).
export async function* mapClaudeStream(
  lines: AsyncIterable<string>,
  opts: { approvalNames: readonly string[]; surfaceTools?: readonly string[] },
): AsyncGenerator<BaseEvent> {
  const blocks = new Map<number, ToolBlock>()
  const emittedToolIds = new Set<string>()
  // Whether text was streamed via deltas since the last message boundary — if so,
  // skip the complete top-level message's text to avoid double-emitting.
  let streamedText = false

  // Only surface tool calls that are part of the agent's contract (the names the
  // client can render). Internal/built-in tools the model may use to reach them
  // (e.g. ToolSearch) are machinery — never show them to the consumer. When
  // `surfaceTools` is omitted, all tool calls pass through (back-compat).
  function shouldSurface(name: string): boolean {
    return !opts.surfaceTools || opts.surfaceTools.includes(name)
  }

  // Emits START/ARGS/END for a tool call (used by both the complete-message path
  // and as a helper). Returns true if it was an approval tool (caller should stop).
  function* emitToolCall(id: string, rawName: string, argsJson: string | undefined): Generator<BaseEvent> {
    const name = stripMcpPrefix(rawName)
    emittedToolIds.add(id)
    yield {
      type: EventType.TOOL_CALL_START,
      toolCallId: id,
      toolCallName: name,
      parentMessageId: crypto.randomUUID(),
    } as BaseEvent
    if (argsJson) {
      yield { type: EventType.TOOL_CALL_ARGS, toolCallId: id, delta: argsJson } as BaseEvent
    }
    yield { type: EventType.TOOL_CALL_END, toolCallId: id } as BaseEvent
  }

  function isApproval(rawName: string): boolean {
    return opts.approvalNames.includes(stripMcpPrefix(rawName))
  }

  for await (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    const obj = parsed as {
      type?: string
      event?: Record<string, unknown>
      is_error?: boolean
      result?: string
      message?: { model?: string; content?: Array<Record<string, unknown>> }
    }

    // A run-level failure (e.g. auth: "Not logged in · Please run /login") arrives
    // as a `result` line, not a stream_event — surface it as readable text and stop.
    if (obj.type === 'result' && obj.is_error) {
      yield textChunk(`Provider error: ${obj.result ?? 'run failed'}`)
      return
    }

    // Complete top-level assistant message (covers non-streamed turns). Skip TEXT
    // from `<synthetic>` messages — those are system-injected notices (e.g. the
    // "Not logged in" auth message), already surfaced via the result-error path;
    // don't echo them as assistant chat text. Real model turns are emitted normally.
    if (obj.type === 'assistant' && obj.message?.content) {
      const synthetic = obj.message.model === '<synthetic>'
      for (const block of obj.message.content) {
        const b = block as { type?: string; text?: string; id?: string; name?: string; input?: unknown }
        if (b.type === 'text' && b.text && !streamedText && !synthetic) {
          yield textChunk(b.text)
        }
        if (b.type === 'tool_use' && b.id && !emittedToolIds.has(b.id) && shouldSurface(stripMcpPrefix(b.name ?? ''))) {
          const argsJson =
            b.input && typeof b.input === 'object' && Object.keys(b.input as object).length > 0
              ? JSON.stringify(b.input)
              : undefined
          yield* emitToolCall(b.id, b.name ?? '', argsJson)
          if (isApproval(b.name ?? '')) return
        }
      }
      streamedText = false
      continue
    }

    if (obj.type !== 'stream_event' || !obj.event) continue
    const ev = obj.event as {
      type?: string
      index?: number
      content_block?: { type?: string; id?: string; name?: string; input?: unknown }
      delta?: { type?: string; text?: string; partial_json?: string }
    }
    const index = typeof ev.index === 'number' ? ev.index : -1

    if (ev.type === 'message_start') {
      streamedText = false
      continue
    }

    if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
      const name = stripMcpPrefix(ev.content_block.name ?? '')
      // Internal/built-in tool (e.g. ToolSearch) — don't track or emit it; its
      // later args/stop lines find no block and are harmlessly ignored.
      if (!shouldSurface(name)) continue
      const id = ev.content_block.id ?? crypto.randomUUID()
      blocks.set(index, { id, name, sawArgs: false, startInput: ev.content_block.input })
      emittedToolIds.add(id)
      yield {
        type: EventType.TOOL_CALL_START,
        toolCallId: id,
        toolCallName: name,
        parentMessageId: crypto.randomUUID(),
      } as BaseEvent
      continue
    }

    if (ev.type === 'content_block_delta') {
      if (ev.delta?.type === 'text_delta' && ev.delta.text) {
        streamedText = true
        yield textChunk(ev.delta.text)
        continue
      }
      if (ev.delta?.type === 'input_json_delta' && typeof ev.delta.partial_json === 'string') {
        const block = blocks.get(index)
        if (block) {
          block.sawArgs = true
          yield { type: EventType.TOOL_CALL_ARGS, toolCallId: block.id, delta: ev.delta.partial_json } as BaseEvent
        }
        continue
      }
      continue
    }

    if (ev.type === 'content_block_stop') {
      const block = blocks.get(index)
      if (!block) continue
      if (
        !block.sawArgs &&
        block.startInput &&
        typeof block.startInput === 'object' &&
        Object.keys(block.startInput as object).length > 0
      ) {
        yield { type: EventType.TOOL_CALL_ARGS, toolCallId: block.id, delta: JSON.stringify(block.startInput) } as BaseEvent
      }
      yield { type: EventType.TOOL_CALL_END, toolCallId: block.id } as BaseEvent
      blocks.delete(index)
      if (opts.approvalNames.includes(block.name)) return
      continue
    }
  }
}
