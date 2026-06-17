import type { Message, ToolCall } from '@atizar/core'

// ─── ThreadItem ───────────────────────────────────────────────────────────────
// The pure data projection of agent.messages → an ordered list of items for the
// thread view. AgentModal maps these items to JSX; buildThreadItems is pure so
// that ordering is unit-testable without a React/DOM environment.

export type ThreadItem =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'toolCall'; id: string; toolCall: ToolCall }
  | { kind: 'lifecycle'; id: string; text: string }
  | {
      kind: 'handoff'
      id: string
      targetAgentId: string
      childWorkItemId?: string
      deduped?: boolean
    }

export type BuildThreadItemsOpts = {
  renderableToolNames: ReadonlySet<string>
  devMode: boolean
}

/**
 * Pure function: projects agent.messages → ordered ThreadItem[].
 *
 * Rules (matching the AgentModal inline flatMap):
 * - role:'system' with non-empty string content → kind:'lifecycle'
 * - role:'assistant' with non-empty string content → kind:'text'
 * - role:'assistant' toolCalls → kind:'toolCall' for each call that passes the
 *   renderability guard (in renderableToolNames, OR devMode is on)
 * - All other roles (user, tool, handoff) are skipped — handoff is Task 4.
 *
 * Order is strictly the input message order.
 */
export function buildThreadItems(messages: Message[], opts: BuildThreadItemsOpts): ThreadItem[] {
  const { renderableToolNames, devMode } = opts
  const items: ThreadItem[] = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]

    // Lifecycle banner: role:'system' messages carry the run-end note
    // (stopped / rejected / etc.) from foldEventsToMessages U4.
    if (msg.role === 'system' && typeof msg.content === 'string' && msg.content.length > 0) {
      items.push({ kind: 'lifecycle', id: `sys-${i}`, text: msg.content })
      continue
    }

    if (msg.role !== 'assistant') continue

    // Assistant text content → chat bubble.
    if (typeof msg.content === 'string' && msg.content.length > 0) {
      items.push({ kind: 'text', id: `text-${i}`, text: msg.content })
    }

    // Assistant tool calls → generative UI cards.
    // Hide internal plumbing (unregistered data-fetch tools) unless devMode.
    if (Array.isArray(msg.toolCalls)) {
      for (const toolCall of msg.toolCalls) {
        const name = toolCall.function?.name ?? ''
        if (!devMode && !renderableToolNames.has(name)) continue
        items.push({ kind: 'toolCall', id: `tc-${toolCall.id}`, toolCall })
      }
    }
  }

  return items
}
