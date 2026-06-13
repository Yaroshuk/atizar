# Extract `@atizar/react` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, green-gate
> checkpoints). This is a code-MOVE + a small dependency-inversion (collapse the render registry,
> inject specs via context). The existing 277-test suite + typecheck + lint + build + a browser E2E
> ARE the verification. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move the board/thread UI machinery from `apps/inbox/client/src/` into `@atizar/react`,
leaving vertical cards + the workflow client bundle in the demo (userland). Realizes belief #3 /
I5 for the client half.

**Architecture:** No build step (`@atizar/*` pattern — `exports` → `./src/index.ts`). Machinery
files `git mv` as a group (preserving their mutual relative imports). Three inversions: (1) the
string-name `renderRegistry` is deleted — `RenderSpec`/`HitlSpec` render closures reference cards
directly; (2) `buildRenderToolCall` + `ThreadModal` read specs from a package context instead of a
static `./workflows` import; (3) `InboxView` → `WorkflowBoard`, props/context-driven. The demo
composes `<WorkflowBoard config={workflowsConfig} />`.

**Tech Stack:** Vite + React 19 + TS, yarn-classic workspace, vitest. Spec → `docs/superpowers/
specs/2026-06-10-extract-platform-react-design.md`.

**Foundation note (run `check-foundation` before the final commit):** realizes I5; `@atizar/core`
stays React-free (spec types live in `@atizar/react`); `defineAgent.renders` in core UNTOUCHED
(I15 keys intact; component-name values become vestigial labels — tidy later, gated). No invariant
weakened.

---

## File Structure (after)

```
packages/react/
  package.json            # new: @atizar/react; exports . + ./styles.css; react = peerDep
  tsconfig.json           # new: providers pattern, ref ../core
  src/
    index.ts              # new barrel: hooks, components, WorkflowBoard, types, context, buildRenderToolCall
    workflowsContext.tsx  # new: WorkflowsConfig type, WorkflowsProvider, useWorkflowsConfig
    WorkflowBoard.tsx     # moved from InboxView.tsx, props/context-driven
    renderSpecs.ts        # moved; types only (drop renderRegistry import + Registry type)
    buildRenderToolCall.tsx  # moved; reads specs from context
    aggregate.ts boardModel.ts pipelineModel.ts status.ts statusDisplay.ts serverTypes.ts devMode.ts threadResults.tsx  # moved
    aggregate.test.ts boardModel.test.ts pipelineModel.test.ts status.test.ts  # moved (machinery tests)
    hooks/{useBoard,useDispatch,useGate,useWorkItemThread}.ts  # moved
    components/{Icon,AgentCard,AgentModal,PipelineColumn,WorkflowSwitcher,InstancePickerModal,ThreadModal}.tsx  # moved
    styles.css            # moved
```

Userland after (`apps/inbox/client/src/`): `App.tsx` (edited), `main.tsx` (edited CSS import),
`workflows.ts` (edited → builds `workflowsConfig`), `buckets.ts` + `buckets.test.ts` (stay),
`deliver.ts` (stays if used, else delete), `renderLead.test.tsx` + `renderVerdict.test.tsx`
(stay, edited), `test/setup.ts` (stays — vitest setupFiles), `vite-env.d.ts` (stays),
`components/{LeadCard,TriageCard,ReplyDraftCard,VerdictCard,TicketResultCard,ApprovalDialog}.tsx`
(stay, edited: `Icon` from `@atizar/react`). **DELETED:** `renderRegistry.tsx`,
`InboxView.tsx` (renamed into the package).

Userland workflow modules (`apps/inbox/workflows/{lead-inbox,github-triage}/client.tsx`): edited —
types + `useThreadResult` from `@atizar/react`; cards referenced directly; drop `registry` param.

---

## Task 1: Scaffold `@atizar/react`

**Files:** create `packages/react/package.json`, `packages/react/tsconfig.json`,
`packages/react/src/index.ts` (placeholder); modify root `tsconfig.json`.

- [ ] **Step 1: `packages/react/package.json`:**

```json
{
  "name": "@atizar/react",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./styles.css": "./src/styles.css"
  },
  "dependencies": {
    "@ag-ui/client": "^0.0.55",
    "@atizar/core": "*",
    "zod": "^3.25.76"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

- [ ] **Step 2: `packages/react/tsconfig.json`** (providers pattern; `jsx` comes from base):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist-types",
    "tsBuildInfoFile": "dist-types/tsconfig.tsbuildinfo",
    "types": ["node"]
  },
  "include": ["src"],
  "references": [{ "path": "../core" }]
}
```

- [ ] **Step 3: placeholder `packages/react/src/index.ts`:** `export {}`

- [ ] **Step 4: root `tsconfig.json`** — add `{ "path": "./packages/react" }` before `./apps/inbox`.

- [ ] **Step 5:** `yarn install --ignore-engines && yarn typecheck` → clean (nothing imports it yet).

- [ ] **Step 6: commit** `chore(react): scaffold empty @atizar/react package`.

---

## Task 2: Move the machinery files into the package

Move as a GROUP so mutual relative imports (`./status`, `./components/Icon`, `../hooks/useGate`,
etc.) stay valid. Do NOT move cards, `buckets*`, `workflows.ts`, `App.tsx`, `main.tsx`, the
`renderLead`/`renderVerdict` tests, `test/`, `vite-env.d.ts`, `deliver.ts`, `renderRegistry.tsx`.

- [ ] **Step 1: `git mv` the machinery** (from repo root):

```bash
cd /Users/yaroshuk/Development/AiWorkflow
mkdir -p packages/react/src/components packages/react/src/hooks
# top-level machinery
for f in aggregate boardModel pipelineModel status statusDisplay serverTypes devMode; do
  git mv apps/inbox/client/src/$f.ts packages/react/src/$f.ts; done
git mv apps/inbox/client/src/threadResults.tsx packages/react/src/threadResults.tsx
git mv apps/inbox/client/src/renderSpecs.ts     packages/react/src/renderSpecs.ts
git mv apps/inbox/client/src/buildRenderToolCall.tsx packages/react/src/buildRenderToolCall.tsx
git mv apps/inbox/client/src/styles.css          packages/react/src/styles.css
git mv apps/inbox/client/src/InboxView.tsx       packages/react/src/WorkflowBoard.tsx
# machinery tests
for f in aggregate boardModel pipelineModel status; do
  git mv apps/inbox/client/src/$f.test.ts packages/react/src/$f.test.ts; done
# hooks
for f in useBoard useDispatch useGate useWorkItemThread; do
  git mv apps/inbox/client/src/hooks/$f.ts packages/react/src/hooks/$f.ts; done
# chrome components
for f in Icon AgentCard AgentModal PipelineColumn WorkflowSwitcher InstancePickerModal ThreadModal; do
  git mv apps/inbox/client/src/components/$f.tsx packages/react/src/components/$f.tsx; done
```

- [ ] **Step 2: confirm what remains in `apps/inbox/client/src`** — should be exactly: `App.tsx`,
  `main.tsx`, `workflows.ts`, `buckets.ts`, `buckets.test.ts`, `deliver.ts`, `renderRegistry.tsx`,
  `renderLead.test.tsx`, `renderVerdict.test.tsx`, `vite-env.d.ts`, `components/{LeadCard,TriageCard,
  ReplyDraftCard,VerdictCard,TicketResultCard,ApprovalDialog}.tsx`, `test/setup.ts`.

Run: `find apps/inbox/client/src -type f | sort` and verify against that list.

- [ ] **Step 3: confirm the moved group's mutual imports survived** — no machinery file should now
  reach back into `apps/inbox`:

Run: `grep -rn "client/src\|apps/inbox" packages/react/src` → expect NO results (the only outward
imports should be `@atizar/core`, `@ag-ui/client`, `react`, `zod`).

(Do NOT green-gate yet — `renderSpecs.ts`/`buildRenderToolCall.tsx`/`WorkflowBoard.tsx` still import
the now-absent `renderRegistry`/`workflows`; fixed in Task 3. Commit happens after Task 3.)

---

## Task 3: Collapse the registry + add the context (the inversion)

**Files:** `packages/react/src/renderSpecs.ts`, `.../buildRenderToolCall.tsx`,
`.../WorkflowBoard.tsx`, `.../components/ThreadModal.tsx`, new `.../workflowsContext.tsx`,
new `.../index.ts`.

- [ ] **Step 1: rewrite `packages/react/src/renderSpecs.ts`** — drop the `renderRegistry` import
  and the `Registry` type; remove the `registry` param from both render signatures:

```ts
import type { ReactElement } from 'react'
import type { z } from 'zod'
import type { Destination } from '@atizar/core'
import type { IconName } from './components/Icon'

export type AgentMeta = { subtitle: string; iconName: IconName; intro: string }
export type DeliverFn = (origin: string, dest: Destination, payload: unknown) => void

export type RenderSpec = {
  toolName: string
  parameters: z.ZodTypeAny
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render: (ctx: { parameters: any }, deliver: DeliverFn) => ReactElement
}

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

- [ ] **Step 2: create `packages/react/src/workflowsContext.tsx`:**

```tsx
import { createContext, useContext, type ReactNode } from 'react'
import type { WorkflowDescriptor } from '@atizar/core'
import type { AgentMeta, RenderSpec, HitlSpec } from './renderSpecs'

// The userland-supplied bundle: descriptors + per-agent chrome meta + render/HITL specs.
// Injected once at the board root; ThreadModal + buildRenderToolCall read it from context.
export type WorkflowsConfig = {
  workflows: WorkflowDescriptor[]
  meta: Record<string, AgentMeta>
  renders: RenderSpec[]
  hitl: HitlSpec[]
}

const WorkflowsContext = createContext<WorkflowsConfig | null>(null)

export const WorkflowsProvider = ({
  config,
  children,
}: {
  config: WorkflowsConfig
  children: ReactNode
}) => <WorkflowsContext.Provider value={config}>{children}</WorkflowsContext.Provider>

export const useWorkflowsConfig = (): WorkflowsConfig => {
  const ctx = useContext(WorkflowsContext)
  if (!ctx) throw new Error('useWorkflowsConfig must be used within a WorkflowsProvider')
  return ctx
}
```

- [ ] **Step 3: rewrite `packages/react/src/buildRenderToolCall.tsx`** — take the spec list as a
  param (no static `./workflows`/`renderRegistry` imports; no `registry` passed to render):

```tsx
import type { ReactNode } from 'react'
import type { ToolCall, ToolMessage } from '@atizar/core'
import type { DeliverFn, RenderSpec } from './renderSpecs'

// Given a folded assistant tool call, parse its args and dispatch to the matching pure render
// spec. `deliver` is the handoff seam (POST /api/deliver). A tool with no registered spec
// (a data-fetch tool) returns null — AgentModal filters those out unless dev mode is on.
export const buildRenderToolCall =
  (renderSpecs: RenderSpec[], deliver: DeliverFn) =>
  ({ toolCall }: { toolCall: ToolCall; toolMessage?: ToolMessage }): ReactNode => {
    const name = toolCall.function?.name
    const spec = renderSpecs.find((s) => s.toolName === name)
    if (!spec) return null
    let parameters: unknown
    try {
      parameters = JSON.parse(toolCall.function?.arguments || '{}')
    } catch {
      return null
    }
    return spec.render({ parameters }, deliver)
  }
```

- [ ] **Step 4: rewrite `packages/react/src/components/ThreadModal.tsx`** — read `renders`+`hitl`
  from context; drop the `renderRegistry`/`../workflows` imports; call specs without a registry:

  Replace the imports
  ```tsx
  import { buildRenderToolCall } from '../buildRenderToolCall'
  import { renderRegistry } from '../renderRegistry'
  import { hitlSpecs } from '../workflows'
  ```
  with
  ```tsx
  import { buildRenderToolCall } from '../buildRenderToolCall'
  import { useWorkflowsConfig } from '../workflowsContext'
  ```
  In the component body add `const { renders, hitl } = useWorkflowsConfig()`, change the memo to
  ```tsx
  const renderToolCall = useMemo(
    () => buildRenderToolCall(renders, (origin, dest, payload) => deliver(origin, dest, payload, id)),
    [renders, deliver, id]
  )
  ```
  and the gate slot to look up in `hitl` and call `spec.render({ form: gate.form, formRev: gate.formRev, status, approve, reject })` (no `renderRegistry` second arg).

- [ ] **Step 5: rewrite `packages/react/src/WorkflowBoard.tsx`** (was InboxView) — take `config`
  prop, wrap the returned tree in `WorkflowsProvider`, source `workflows`/`META`/`renderSpecs`/
  `hitlSpecs` from `config` instead of `import … from './workflows'`:

  - Signature: `export const WorkflowBoard = ({ config }: { config: WorkflowsConfig }) => { const { workflows, meta: META, renders: renderSpecs, hitl: hitlSpecs } = config; … }`
  - Drop `import { workflows, META, renderSpecs, hitlSpecs } from './workflows'` and the
    `import type { WorkItem } from './serverTypes'` stays (now sibling). Keep all other logic.
  - Wrap the top-level `<>…</>` return in `<WorkflowsProvider config={config}> … </WorkflowsProvider>`.
  - Import `WorkflowsProvider`, `useWorkflowsConfig` is NOT needed here (it has `config` directly);
    only ThreadModal/buildRenderToolCall use the context. Keep passing `deliver` etc. as today.

- [ ] **Step 6: write the barrel `packages/react/src/index.ts`:**

```ts
export { WorkflowBoard } from './WorkflowBoard.js'
export { WorkflowsProvider, useWorkflowsConfig } from './workflowsContext.js'
export type { WorkflowsConfig } from './workflowsContext.js'
export type { AgentMeta, DeliverFn, RenderSpec, HitlSpec } from './renderSpecs.js'
export { buildRenderToolCall } from './buildRenderToolCall.js'
export { useThreadResult, ThreadResultsContext } from './threadResults.js'
export { Icon } from './components/Icon.js'
export type { IconName } from './components/Icon.js'
// hooks (the headless layer)
export { useBoard } from './hooks/useBoard.js'
export { useDispatch } from './hooks/useDispatch.js'
export { useGate } from './hooks/useGate.js'
export { useWorkItemThread } from './hooks/useWorkItemThread.js'
```

(Cross-check each export against the actual moved file's exports — adjust names to match; e.g.
confirm `threadResults.tsx` exports `useThreadResult` + `ThreadResultsContext`, `Icon.tsx` exports
`Icon` + `IconName`. Do NOT invent.)

- [ ] **Step 7: typecheck the package alone:** `npx tsc --build packages/react` → fix any
  export-name mismatch in the barrel against the moved code. (App still broken — that's Task 4.)

---

## Task 4: Rewire userland (cards, workflow modules, demo composition, delete registry)

**Files:** the 6 cards, `workflows.ts`, `App.tsx`, `main.tsx`, both workflow `client.tsx`,
`renderLead.test.tsx`, `renderVerdict.test.tsx`, delete `renderRegistry.tsx`; `apps/inbox/package.json`.

- [ ] **Step 1: add the dep** — `apps/inbox/package.json` deps gain `"@atizar/react": "*"`; then
  `yarn install --ignore-engines`.

- [ ] **Step 2: cards — `Icon` import** — in each of `LeadCard`, `TriageCard`, `ReplyDraftCard`,
  `VerdictCard`, `TicketResultCard`, `ApprovalDialog`: change `import { Icon } from './Icon'` →
  `import { Icon } from '@atizar/react'`. (TriageCard keeps `import { groupByStatus, type TriageTicket } from '../buckets'`.)

- [ ] **Step 3: workflow client modules** (`apps/inbox/workflows/lead-inbox/client.tsx`,
  `.../github-triage/client.tsx`):
  - Types: `import type { RenderSpec, HitlSpec, AgentMeta, DeliverFn } from '@atizar/react'`
    (was `../../client/src/renderSpecs`).
  - `useThreadResult`: `import { useThreadResult } from '@atizar/react'` (was `../../client/src/threadResults`).
  - Drop the `Registry` import. Import the card components directly, e.g.
    `import { LeadCard } from '../../client/src/components/LeadCard'` etc.
  - In every render closure: drop the `registry` parameter; replace `const X = registry['XCard']`
    + `<X .../>` with the directly-imported component `<XCard .../>`. (TriageCardConnected drops its
    `registry` prop too and references `TriageCard` directly.)

- [ ] **Step 4: `apps/inbox/client/src/workflows.ts`** — import spec TYPES from `@atizar/react`;
  build and export a `workflowsConfig: WorkflowsConfig` bundle (keep the dedupe-by-toolName):

```ts
import type { WorkflowsConfig } from '@atizar/react'
import { workflowDescriptors } from '../../workflows'
import { leadInboxMeta, leadInboxRenders, leadInboxHitl } from '../../workflows/lead-inbox/client'
import { githubTriageMeta, githubTriageRenders } from '../../workflows/github-triage/client'
import type { AgentMeta, RenderSpec, HitlSpec } from '@atizar/react'

export type { AgentMeta }
const byName = <T extends { toolName: string }>(specs: T[]): T[] => {
  const seen = new Set<string>()
  return specs.filter((s) => (seen.has(s.toolName) ? false : (seen.add(s.toolName), true)))
}
const META: Record<string, AgentMeta> = { ...leadInboxMeta, ...githubTriageMeta }
const renderSpecs: RenderSpec[] = byName([...leadInboxRenders, ...githubTriageRenders])
const hitlSpecs: HitlSpec[] = byName<HitlSpec>([...leadInboxHitl])

export const workflowsConfig: WorkflowsConfig = {
  workflows: workflowDescriptors,
  meta: META,
  renders: renderSpecs,
  hitl: hitlSpecs,
}
```

(Drop the now-unused `WorkflowView`/`workflowViews`/`renderRegistry`/`ComponentType` bits unless
something imports them — grep first; if `workflowViews` is unused, remove it.)

- [ ] **Step 5: `apps/inbox/client/src/App.tsx`:**

```tsx
import { WorkflowBoard } from '@atizar/react'
import { workflowsConfig } from './workflows'

export const App = () => <WorkflowBoard config={workflowsConfig} />
```

- [ ] **Step 6: `apps/inbox/client/src/main.tsx`** — CSS now comes from the package:

  Change `import './styles.css'` → `import '@atizar/react/styles.css'`.

- [ ] **Step 7: delete `apps/inbox/client/src/renderRegistry.tsx`:** `git rm apps/inbox/client/src/renderRegistry.tsx`.

- [ ] **Step 8: update `renderLead.test.tsx` + `renderVerdict.test.tsx`** — they exercise the
  lead-inbox render specs. Update for the new signature: specs are called `spec.render({ parameters }, deliver)`
  with NO registry arg; import `RenderSpec` type from `@atizar/react` if referenced; assert the
  card renders directly. (Read each test; adjust the call sites + any `renderRegistry` import. Keep
  them in `apps/inbox/client/src/` — userland tests of userland specs.)

- [ ] **Step 9: handle `deliver.ts`** — `grep -rn "from './deliver'\|from '../deliver'" apps/inbox`.
  If unused, `git rm apps/inbox/client/src/deliver.ts`; if used, leave it.

- [ ] **Step 10: full green gate:**

Run: `yarn typecheck && yarn test && yarn lint && yarn build && yarn format:check`
Expected: typecheck clean; 277 tests pass (machinery tests now under `packages/react/src`, the two
render tests + buckets test under the app); lint green; vite build succeeds (the CSS import resolves
via the package export); prettier clean on changed files. Fix mismatches (the most likely: a missed
import-site still pointing at a moved `./client/src/...` path — grep `apps/inbox` for stragglers).

- [ ] **Step 11: commit** the move + inversion + rewire (one commit, files overlap):
  `refactor(react): extract board/thread UI into @atizar/react (typed-spec context injection)`.

---

## Task 5: Browser E2E + foundation check + HANDOFF

- [ ] **Step 1: `check-foundation`** over the diff → expect CLEAR (I5 realized; core React-free;
  `defineAgent.renders` untouched). Record the verdict.

- [ ] **Step 2: `browser-verify` skill** (clean stale stacks, free :4000/:5173). Then
  `DEV_RECORD_REPLAY=1 yarn dev`. Confirm ONE `:4000` + `0` EADDRINUSE; confirm the app is STYLED
  (CSS export resolved).

- [ ] **Step 3: drive the lead-inbox flow through `@atizar/react`** (`http://localhost:5173/?dev=1`):
  board loads + styled; START → qualifier Working→Done; reply gate opens; **approve WITH an edited
  body → fetch the real Gmail draft by id → the edit is present** (then delete the test draft);
  reject → `finished`/`rejected`, 0 ledger; cancel → `finished`/`cancelled`, gate 404; reload
  re-attach (`?open=<id>`); render cards (LeadCard, ApprovalDialog) appear — proves the context
  injection + direct-card refs work.

- [ ] **Step 4: scan for "only the browser catches"** — cards render (not blank — a blank card =
  context not provided or a broken direct import); text is ONE bubble; no console errors beyond the
  benign favicon 404; tool chips flip Running→Done (`?dev=1`).

- [ ] **Step 5: reset the dev DB** (`yarn workspace inbox db:reset`) to keep the startup sweep clean.

- [ ] **Step 6: update `HANDOFF.md`** — 7b ✅ BUILT & browser-verified, As-built note (commits, the
  registry collapse, the context API, buckets-stays-userland correction); next = 7c (slim demo +
  packaging tail). **Commit** `docs(handoff): @atizar/react extracted & browser-verified (7b); next = 7c`.

---

## Self-Review

- **Spec coverage:** injection contract (Task 3 context + renderSpecs collapse), machinery move
  (Task 2), userland rewire incl. direct card refs (Task 4), foundation conditions (note + Task 5
  Step 1). ✅
- **No invented names:** barrel (T3.S6) + workflows.ts (T4.S4) say "cross-check against actual
  moved code; do not invent." ✅
- **buckets stays userland** (T2 excludes it; T4.S2 keeps TriageCard's `../buckets`). ✅
- **Tests:** machinery tests move (T2.S1); render/buckets tests stay + render tests updated
  (T4.S8). vitest `include` already globs both locations. ✅
- **Browser E2E required**, incl. the CSS-styled + cards-render checks unique to this step (T5). ✅
