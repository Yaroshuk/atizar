import { describe, it, expect } from 'vitest'
import { lookups } from './lookups'
import type { WorkflowsConfig } from './workflowsContext'
import type { WorkItem } from './serverTypes'

const cfg = {
  workflows: [
    {
      id: 'lead-inbox',
      label: 'Lead inbox',
      agents: [
        { agent: { id: 'qualifier', name: 'LEAD QUALIFIER' }, role: 'input' },
        { agent: { id: 'reply', name: 'REPLY AGENT' }, role: 'worker' },
      ],
    },
  ],
  meta: { qualifier: { iconName: 'inbox' }, reply: { iconName: 'reply' } },
  renders: [],
  hitl: [],
} as unknown as WorkflowsConfig

const wi = (over: Partial<WorkItem>): WorkItem =>
  ({
    id: 'w1',
    workflowId: 'lead-inbox',
    agentId: 'lead-inbox__reply',
    payload: {},
    ...over,
  }) as WorkItem

// Mirrors the resolveHandoff extraction in RunView.tsx: given a handoff event whose
// targetAgentId is a BARE id (as set by runObserver.ts `targetAgentId: to`), the bare-agent
// extraction must yield the correct agent id so defOf returns the display name.
describe('resolveHandoff bare-agent extraction', () => {
  it('resolves a BARE targetAgentId to the display name via defOf', () => {
    const { defOf } = lookups(cfg, 'lead-inbox')
    const childWorkflowId = 'lead-inbox'

    // Simulate the BUGGY extraction (the old slice logic):
    const buggyBareId = 'reply'.slice(childWorkflowId.length + 2) // '' (empty string)
    const buggyName = defOf(childWorkflowId, buggyBareId)?.name ?? 'reply'
    // This is the bug: defOf returns undefined for '' → falls back to the raw 'reply'
    expect(buggyBareId).toBe('')
    expect(buggyName).toBe('reply') // lowercase bare id, not the display name

    // Simulate the FIXED extraction (__ split):
    const bareTargetId = 'reply'
    const fixedBareId = bareTargetId.includes('__')
      ? bareTargetId.slice(bareTargetId.indexOf('__') + 2)
      : bareTargetId
    const fixedName = defOf(childWorkflowId, fixedBareId)?.name ?? bareTargetId
    expect(fixedBareId).toBe('reply')
    expect(fixedName).toBe('REPLY AGENT') // correct display name
  })

  it('also handles a namespaced wf__agent targetAgentId (backward compat)', () => {
    const { defOf } = lookups(cfg, 'lead-inbox')
    const childWorkflowId = 'lead-inbox'

    // A namespaced id like 'lead-inbox__reply' must also resolve correctly with the fix:
    const namespacedId = 'lead-inbox__reply'
    const fixedBareId = namespacedId.includes('__')
      ? namespacedId.slice(namespacedId.indexOf('__') + 2)
      : namespacedId
    const fixedName = defOf(childWorkflowId, fixedBareId)?.name ?? namespacedId
    expect(fixedBareId).toBe('reply')
    expect(fixedName).toBe('REPLY AGENT')
  })
})

describe('lookups', () => {
  it('resolves role, name, icon, stripped agent id, and label', () => {
    const lk = lookups(cfg, 'lead-inbox')
    expect(lk.roleOf('qualifier')).toBe('input')
    expect(lk.nameOf('reply')).toBe('REPLY AGENT')
    expect(lk.nameOf('unknown')).toBe('unknown')
    expect(lk.metaIcon('reply')).toBe('reply')
    expect(lk.metaIcon('missing')).toBe('inbox')
    expect(lk.stripAgent(wi({}))).toBe('reply')
  })
  it('labels by issue number, else from/subject', () => {
    const lk = lookups(cfg, 'lead-inbox')
    expect(lk.labelOf(wi({ payload: { number: 5, title: 'Bug' } }))).toBe('#5 · Bug')
    expect(lk.labelOf(wi({ payload: { from: 'a@b.com' } }))).toBe('a@b.com')
    expect(lk.labelOf(wi({ payload: { subject: 'Hi' } }))).toBe('Hi')
  })
  it('labels a reply by the sender from the nested email payload (display name preferred)', () => {
    const lk = lookups(cfg, 'lead-inbox')
    expect(
      lk.labelOf(wi({ payload: { email: { from: 'Sam Carter <sam@harborfreight.example>' } } }))
    ).toBe('Sam Carter')
    expect(lk.labelOf(wi({ payload: { email: { from: 'jane@acme.example' } } }))).toBe(
      'jane@acme.example'
    )
  })
})
