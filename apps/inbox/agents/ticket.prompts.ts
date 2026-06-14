import type { RunAgentInput } from '@ag-ui/client'
import {
  decodeHandoff,
  TicketHandoffPayloadSchema,
  type PromptStrategy,
  type TicketHandoffPayload,
} from '@atizar/core'

type TicketPromptConfig = {
  renderTool: 'render_ticket_result' | 'render_reply_draft'
  kind: 'feature' | 'bug' | 'reply'
}

function noTicketFirst(instructions: string): string {
  return [
    instructions,
    '',
    'No ticket has been routed to you. You do not read the board — the Triage agent',
    'does that. Reply with ONE short sentence telling the user to start from Triage',
    'and route a ticket to you. Do not call any tool and do not narrate tool usage.',
  ].join('\n')
}

function resultFirst(instructions: string, t: TicketHandoffPayload, kind: string): string {
  return [
    instructions,
    '',
    `A ticket was routed to you (recommendation "${t.recommendation}").`,
    `Repo ${t.repo}, issue #${t.number}, status "${t.status}", priority "${t.priority}".`,
    `Title: ${t.title}`,
    `Description: ${t.body}`,
    t.lastComment
      ? `Last comment by ${t.lastComment.author}: ${t.lastComment.body}`
      : 'No comments.',
    'Do NOT fetch anything — use only the context above (you have no GitHub access).',
    `Produce a concise ${kind} analysis/plan, then call render_ticket_result with`,
    `{ title, kind: "${kind}", analysis } where title is the ticket title and analysis`,
    'is your write-up. The card already shows the analysis — do not restate it in your',
    'text. Reply with at most ONE short plain sentence; do not narrate tool usage.',
  ].join('\n')
}

function replyFirst(instructions: string, t: TicketHandoffPayload): string {
  return [
    instructions,
    '',
    `A ticket was routed to you for a suggested reply. Repo ${t.repo}, issue #${t.number}.`,
    `Title: ${t.title}`,
    `Description: ${t.body}`,
    t.lastComment
      ? `Last comment by ${t.lastComment.author}: ${t.lastComment.body}`
      : 'No comments.',
    'Do NOT fetch anything and do NOT post anything (you have no GitHub access — this is',
    'a DRAFT only). Draft a short, helpful reply comment answering the last comment, then',
    'call render_reply_draft with { title, draft } where title is the ticket title and',
    'draft is your suggested reply. The card already shows the draft — do not restate it',
    'in your text. Reply with at most ONE short plain sentence; do not narrate tools.',
  ].join('\n')
}

export function createTicketPrompts(instructions: string, cfg: TicketPromptConfig): PromptStrategy {
  return {
    buildFirst(input: RunAgentInput): string {
      const t = decodeHandoff(input, TicketHandoffPayloadSchema)
      if (!t) return noTicketFirst(instructions)
      return cfg.renderTool === 'render_reply_draft'
        ? replyFirst(instructions, t)
        : resultFirst(instructions, t, cfg.kind)
    },
    // No buildResume: no approvals in the read-only GitHub flow.
  }
}
