# AiWorkflow — Open-source framework for agent automations

Framework for AI engineers who ship agentic automations to clients:
code for the engineer, a polished UI for the client. Default focus —
inbound flows (email/leads → qualify → human approval → action).

## Agent-First Project — Continuous Learning

This is an **agent-first project**. Every correction or decision that
isn't persisted is one that will repeat.

- New pattern / preference / decision → update this file or `.claude/skills/rules/`
- Architectural decision → record it here under "Decisions"
- These rules grow **organically** — add a rule the moment a real pattern
  appears in the code, not before.

## Current State

First milestone: vertical slice on mocks — one agent card, START runs a
mock agent through the real CopilotKit + AG-UI loop (text → lead card →
approval → resume). See:
- Spec: `docs/superpowers/specs/2026-06-06-inbox-vertical-slice-design.md`
- Plan: `docs/superpowers/plans/2026-06-06-inbox-vertical-slice.md`

## Stack

- Client: Vite + React + TypeScript
- Server: Hono (thin BFF)
- Agent UI: CopilotKit + AG-UI (`@copilotkit/runtime` v2, `@copilotkit/react-core`)
- Mocked for now: real model, Mastra, Gmail, DB, auth

## Decisions

- Server = Hono (Web-Standards / fetch; mounts CopilotKit endpoint without adapters). Swappable behind a thin layer.
- Slice verified by manual click-through; TDD + review loop starts with the reusable core layer (next phase).
- Config split (later): structure in files, manager-editable text fields in DB; secrets in env only.
- Models accessed via a separate provider registry (CLI / API); agents reference a provider by name.

## Commands

(Filled in Task 1 once the app exists.)
