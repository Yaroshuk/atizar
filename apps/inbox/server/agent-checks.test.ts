import { describe, it, expect } from 'vitest'
import { defineAgent } from '@platform/core'
import { assertAgentClassification } from './agent-checks.js'

const reply = defineAgent({
  id: 'reply',
  name: 'REPLY',
  provider: 'claude-cli',
  instructions: 'x',
  tools: ['renderLead', 'saveDraft'],
  approvals: ['saveDraft'],
  effects: ['saveDraft'],
  renders: { renderLead: 'LeadCard', saveDraft: 'ApprovalDialog' },
})

const dispatcher = defineAgent({
  id: 'dispatcher',
  name: 'DISPATCHER',
  provider: 'claude-cli',
  instructions: 'x',
  tools: ['renderLead', 'route_to_qualifier'],
  approvals: [],
  renders: {},
  readonly: ['renderLead'],
  dispatches: ['route_to_qualifier'],
})

describe('assertAgentClassification', () => {
  it('passes when every allow-listed tool is classified and effects are bound', () => {
    expect(() =>
      assertAgentClassification(reply, {
        allowedTools: ['mcp__inbox__renderLead', 'mcp__inbox__saveDraft'],
        effects: { saveDraft: async () => ({}) },
      })
    ).not.toThrow()
  })

  it('passes when a dispatch tool is classified only via dispatches', () => {
    expect(() =>
      assertAgentClassification(dispatcher, {
        allowedTools: ['mcp__inbox__renderLead', 'mcp__inbox__route_to_qualifier'],
      })
    ).not.toThrow()
  })

  it('throws when an allow-listed tool is unclassified', () => {
    expect(() =>
      assertAgentClassification(reply, {
        allowedTools: [
          'mcp__inbox__renderLead',
          'mcp__inbox__saveDraft',
          'mcp__gmail__create_draft',
        ],
        effects: { saveDraft: async () => ({}) },
      })
    ).toThrow(/create_draft.*not classified/)
  })

  it('throws when a dispatch-only agent has an allow-listed tool in none of the five classes', () => {
    expect(() =>
      assertAgentClassification(dispatcher, {
        allowedTools: [
          'mcp__inbox__renderLead',
          'mcp__inbox__route_to_qualifier',
          'mcp__inbox__phantom_tool',
        ],
      })
    ).toThrow(/phantom_tool.*not classified/)
  })

  it('throws when a declared effect has no bound function', () => {
    expect(() =>
      assertAgentClassification(reply, {
        allowedTools: ['mcp__inbox__renderLead', 'mcp__inbox__saveDraft'],
        effects: {},
      })
    ).toThrow(/effect "saveDraft" declared but not bound/)
  })

  it('throws when a bound effect is not declared', () => {
    expect(() =>
      assertAgentClassification(reply, {
        allowedTools: ['mcp__inbox__renderLead', 'mcp__inbox__saveDraft'],
        effects: { saveDraft: async () => ({}), phantom: async () => ({}) },
      })
    ).toThrow(/effect "phantom" bound but not declared/)
  })
})
