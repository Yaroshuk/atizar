# `@platform/react` Extraction — Design

**Status:** design locked (2026-06-10). Sub-step 7b of the beta build order (HANDOFF). Follows 7a
(`@platform/server` extracted). `check-foundation` verdict on the injection API = CLEAR (recorded
in HANDOFF 7b note).

## Goal

Extract the board/thread UI from `apps/inbox/client/src/` into a public package `@platform/react`,
realizing belief #3's physical boundary for the client half: **machinery in the package, cards in
userland.** The demo app keeps only its vertical-specific cards + the workflow client bundle and
composes the package's board.

## The injection contract (the one real design decision)

Userland gives the package its workflow specs + cards through **typed-spec props + one
package-level React context** — NOT a global mutable `registerCard` singleton. (`registerCard` in
the inventory named the *capability* "userland plugs cards in"; props/context IS that mechanism,
and it is React-idiomatic, StrictMode/test-safe, and supports two boards with different configs.)

The string-name render registry is **collapsed**: `RenderSpec`/`HitlSpec` render functions
reference their card components DIRECTLY (userland closures), so the package never sees a
`Record<name, Component>`. This mirrors the `effects` pattern — names in core (classification,
I15), implementations bound outside (server: effect fns; client: spec render closures).

### Types (live in `@platform/react`)

```ts
import type { ReactElement } from 'react'
import type { z } from 'zod'
import type { Destination } from '@platform/core'

export type AgentMeta = { subtitle: string; iconName: IconName; intro: string }
export type DeliverFn = (origin: string, dest: Destination, payload: unknown) => void

// A pure render tool (generative UI). `render` may call `deliver` for handoff cards.
// NO registry param — the closure references its card component directly.
export type RenderSpec = {
  toolName: string
  parameters: z.ZodTypeAny
  render: (ctx: { parameters: any }, deliver: DeliverFn) => ReactElement // eslint any: heterogeneous args
}

// A human-in-the-loop tool. The server GATE is authoritative; the card edits the gate `form`
// and calls approve(editedForm) / reject(comment). NO registry param.
export type HitlSpec = {
  toolName: string
  parameters: z.ZodTypeAny
  render: (ctx: {
    form: Record<string, unknown>
    formRev: number
    status: string
    approve: (form: Record<string, unknown>) => void
    reject: (comment?: string) => void
  }) => ReactElement
}
```

### Config + context

```ts
import type { WorkflowDescriptor } from '@platform/core'

export type WorkflowsConfig = {
  workflows: WorkflowDescriptor[]
  meta: Record<string, AgentMeta> // keyed by stripped agent id
  renders: RenderSpec[] // deduped by tool name (userland aggregator's job)
  hitl: HitlSpec[]
}
```

`@platform/react` exports `<WorkflowBoard config={WorkflowsConfig} />` (the renamed `InboxView`).
Internally it wraps its subtree in a single `WorkflowsProvider` that puts `config` on context;
`ThreadModal` and `buildRenderToolCall` read it via `useWorkflowsConfig()` — no prop threading
through `AgentModal`/`PipelineColumn`/etc. The demo's `App` becomes:

```tsx
import { WorkflowBoard } from '@platform/react'
import { workflowsConfig } from './workflows' // userland aggregator builds the bundle
export const App = () => <WorkflowBoard config={workflowsConfig} />
```

## What moves vs stays

**Into `@platform/react` (machinery):**
- Hooks: `useBoard`, `useDispatch`, `useGate`, `useWorkItemThread`.
- Models/helpers: `boardModel`, `pipelineModel`, `aggregate`, `status`, `statusDisplay`,
  `serverTypes`, `devMode`, `threadResults` (generic thread-results context).
- Render machinery: `renderSpecs` (TYPES only — drop the `renderRegistry` import + `Registry`
  type), `buildRenderToolCall` (reads specs from context, not a static import).
- Chrome components: `Icon`, `AgentCard`, `AgentModal`, `ThreadModal`, `PipelineColumn`,
  `WorkflowSwitcher`, `InstancePickerModal`, and `InboxView` → renamed `WorkflowBoard`
  (props/context-driven).
- New: `workflowsContext.tsx` (the `WorkflowsProvider` + `useWorkflowsConfig` hook).
- `styles.css` (the Smedja theme — ported as-is).

**Stays in `apps/inbox/client/src/` (userland):**
- Cards: `LeadCard`, `TriageCard`, `ReplyDraftCard`, `VerdictCard`, `TicketResultCard`,
  `ApprovalDialog`.
- `buckets.ts` — **vertical-specific** (`TriageTicket`/`groupByStatus`, used only by TriageCard +
  github-triage/client). NOT machinery → stays userland. (Audit correction to the earlier
  inventory, which mislisted it as a package model.)
- `workflows.ts` — the demo aggregator; now builds a `WorkflowsConfig` bundle (`workflowsConfig`)
  from the per-workflow client modules and exports it.
- `App.tsx`, `main.tsx` (composition root; `main.tsx` keeps `import './styles.css'` via the
  package export — see below).
- **DELETED:** `renderRegistry.tsx` (the name→component map; the indirection is collapsed).

**Userland workflow client modules** (`apps/inbox/workflows/{lead-inbox,github-triage}/client.tsx`):
- Import `RenderSpec`/`HitlSpec`/`AgentMeta`/`DeliverFn` from `@platform/react` (was
  `../../client/src/renderSpecs`).
- Import `useThreadResult` from `@platform/react` (was `../../client/src/threadResults`).
- `TriageTicket` still from `../../client/src/buckets` (stays userland).
- Render closures reference card components DIRECTLY (e.g. `return <LeadCard lead={…} />`) instead
  of `registry['LeadCard']`; drop the `registry` parameter from every render fn.

## Foundation conditions (locked)

- `@platform/core` stays React-free — the spec TYPES live in `@platform/react`, never core.
- `defineAgent.renders` in core is **NOT touched** this step. Its keys still feed I15
  classification + server card-filling; the component-name VALUES become vestigial labels. A
  possible `Record → array` tidy is a separate, explicit `check-foundation`-gated change at the
  ARCHITECTURE §3 doc level, post-extraction — never silent.
- I15 keys untouched; I5 strengthened (boundary now physical for the client too).

## Package mechanics

- No build step (the `@platform/*` pattern): `exports` → `./src/index.ts` for the JS surface, plus
  a CSS export `"./styles.css": "./src/styles.css"` so the demo does `import '@platform/react/styles.css'`.
- `package.json` deps: `@platform/core`, `@ag-ui/client` (BaseEvent in `useWorkItemThread`), `zod`
  (spec param schemas — peer/runtime), `react` as a **peerDependency** (the app owns the React
  singleton). `tsconfig.json` follows the providers pattern (package-local `outDir`/`tsBuildInfoFile`,
  `references: [{ path: '../core' }]`); root `tsconfig.json` gains the project ref. vitest `include`
  already globs `packages/*/src/**` so moved client tests (renderLead/renderVerdict/aggregate/
  boardModel/buckets/pipelineModel/status) run — EXCEPT `buckets.test.ts` stays in the app with
  `buckets.ts`.
- `apps/inbox` adds `@platform/react: "*"` to deps.

## Risks / what only the browser catches

- The context indirection: if `WorkflowsProvider` isn't mounted above `ThreadModal`, the gate card
  + tool rendering silently no-op. Browser-verify the full flow (render cards, approve gate).
- The CSS export path: a wrong `exports` key → unstyled app (build/typecheck won't catch). Browser-verify.
- `useThreadResult` moving packages: TriageCard reads `list_my_tickets` results via the context —
  github-triage is read-only and has no replay cassette, so this path is verified by the existing
  unit tests + a board read, not a live triage run (honest limitation, same as 7a).

## Definition of done

Typecheck + 277 tests + lint + build + format(my files) green; `check-foundation` CLEAR; browser
E2E of the lead-inbox flow through `@platform/react` (board, single run, render cards, approve WITH
edit → real Gmail draft, reject, cancel, reload re-attach); `@copilotkit` still absent; HANDOFF 7b
marked ✅ with an As-built note; next = 7c (slim demo + packaging tail).
