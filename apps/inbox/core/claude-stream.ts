import { EventType, type BaseEvent } from '@ag-ui/client'

// Claude Code MCP tools surface as `mcp__<server>__<tool>`; the client registered
// the bare names (`renderLead`, `confirmSend`), so strip the prefix.
function stripMcpPrefix(name: string): string {
  if (!name.startsWith('mcp__')) return name
  const rest = name.slice('mcp__'.length)
  const sep = rest.indexOf('__')
  return sep === -1 ? name : rest.slice(sep + 2)
}

type ToolBlock = { id: string; name: string; sawArgs: boolean; startInput: unknown }

// Parses the `claude --output-format stream-json` NDJSON stream into AG-UI events.
// Stops (returns) right after emitting TOOL_CALL_END for an approval tool — the
// caller then kills the subprocess (turn-1 HITL pause).
export async function* mapClaudeStream(
  lines: AsyncIterable<string>,
  opts: { approvalNames: readonly string[] },
): AsyncGenerator<BaseEvent> {
  const blocks = new Map<number, ToolBlock>()

  for await (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    const obj = parsed as { type?: string; event?: Record<string, unknown> }
    if (obj.type !== 'stream_event' || !obj.event) continue
    const ev = obj.event as {
      type?: string
      index?: number
      content_block?: { type?: string; id?: string; name?: string; input?: unknown }
      delta?: { type?: string; text?: string; partial_json?: string }
    }
    const index = typeof ev.index === 'number' ? ev.index : -1

    if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
      const id = ev.content_block.id ?? crypto.randomUUID()
      const name = stripMcpPrefix(ev.content_block.name ?? '')
      blocks.set(index, { id, name, sawArgs: false, startInput: ev.content_block.input })
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
        yield {
          type: EventType.TEXT_MESSAGE_CHUNK,
          role: 'assistant',
          messageId: crypto.randomUUID(),
          delta: ev.delta.text,
        } as BaseEvent
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
