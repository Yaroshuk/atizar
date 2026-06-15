// @vitest-environment node
//
// Drift guard: the prompt prose must reference tool names ONLY through the EMAIL_INBOX_TOOLS
// consts, and the descriptor's wire ids (handoffs, workflow id) must come from the EMAIL_INBOX_*
// const maps. This catches a raw string literal silently drifting from its const (a rename that
// updates the const but leaves a hand-typed copy behind). Deterministic — no fragile "words after
// Call" parsing: we enumerate every tool-shaped token in the prose and assert each is a known const.
import { describe, it, expect } from 'vitest'
import type { RunAgentInput } from '@ag-ui/client'
import type { PromptStrategy } from '@atizar/core'
import { encodeHandoff } from '@atizar/core'
import { sorterPrompt, replyPrompt, readerPrompt, spamPrompt, importantPrompt } from './prompts.js'
import { EMAIL_INBOX_TOOLS } from './tools.js'
import { EMAIL_INBOX_AGENTS, EMAIL_INBOX_ID } from './ids.js'
import { emailInbox } from './descriptor.js'

const KNOWN_TOOLS = new Set<string>(Object.values(EMAIL_INBOX_TOOLS))

const inputWith = (payload: unknown): RunAgentInput =>
  ({
    messages: payload ? [encodeHandoff(payload)] : [],
    threadId: 't',
    runId: 'r',
    state: {},
    tools: [],
    context: [],
    forwardedProps: {},
  }) as RunAgentInput

const sampleEmail = { messageId: 'm_1', threadId: 't_1', from: 'a@b.c', subject: 'Hi' }
const sampleBatch = { emails: [sampleEmail] }

// All prompt strings for one strategy: onStart (no handoff), a representative onInput (with the
// seeded payload), and onResume. Concatenated so the scan sees every tool the agent references.
const allProse = (p: PromptStrategy, payload: unknown): string =>
  [
    p.buildFirst(inputWith(null)),
    p.buildFirst(inputWith(payload)),
    p.buildResume?.({}, { draftId: 'd-1', applied: 1, failed: [] }) ?? '',
  ].join('\n')

// A "tool-shaped" token: snake_case (route_emails, get_email, list_unread) OR a camelCase
// identifier beginning with a tool verb prefix the workflow uses (render*/save*/apply*). This is
// the universe of literals that COULD be a tool name; every one found must be a known const.
const TOOL_TOKEN = /\b([a-z]+_[a-z_]+|(?:render|save|apply)[A-Z][A-Za-z]+)\b/g

const cases: Array<{ name: string; strategy: PromptStrategy; payload: unknown }> = [
  { name: 'sorter', strategy: sorterPrompt, payload: null },
  { name: 'reply', strategy: replyPrompt, payload: { email: sampleEmail } },
  { name: 'reader', strategy: readerPrompt, payload: sampleBatch },
  { name: 'spam', strategy: spamPrompt, payload: sampleBatch },
  { name: 'important', strategy: importantPrompt, payload: sampleBatch },
]

describe('prompt drift guard — no raw tool literals', () => {
  for (const { name, strategy, payload } of cases) {
    it(`${name}: every tool-shaped token in the prose is a known const`, () => {
      const prose = allProse(strategy, payload)
      const found = new Set<string>()
      for (const m of prose.matchAll(TOOL_TOKEN)) found.add(m[1])
      // Every tool-shaped token must be a real EMAIL_INBOX_TOOLS value (no drift).
      for (const token of found) {
        expect(
          KNOWN_TOOLS,
          `"${token}" in ${name} prose is not an EMAIL_INBOX_TOOLS const`
        ).toContain(token)
      }
      // And the prose must mention at least one tool (sanity — the scan isn't vacuously passing).
      expect(found.size).toBeGreaterThan(0)
    })
  }
})

describe('descriptor wire ids come from the const maps', () => {
  it('workflow id === EMAIL_INBOX_ID', () => {
    expect(emailInbox.id).toBe(EMAIL_INBOX_ID)
  })

  it('every handoff target on every agent is a value in EMAIL_INBOX_AGENTS', () => {
    const knownAgents = new Set<string>(Object.values(EMAIL_INBOX_AGENTS))
    for (const { agent } of emailInbox.agents) {
      for (const target of agent.handoffs ?? []) {
        expect(
          knownAgents,
          `handoff "${target}" on "${agent.id}" is not a known agent id`
        ).toContain(target)
      }
    }
  })

  it('every agent id is a value in EMAIL_INBOX_AGENTS', () => {
    const knownAgents = new Set<string>(Object.values(EMAIL_INBOX_AGENTS))
    for (const { agent } of emailInbox.agents) {
      expect(knownAgents).toContain(agent.id)
    }
  })
})
