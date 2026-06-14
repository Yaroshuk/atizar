# WS1 — Frontend Conventions + Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codify component file/folder structure rules in `docs/CONVENTIONS.md` and bring the
`@atizar/react` package + the demo `BoardApp` to them (one component per file; folder-per-component;
CSS Modules co-located).

**Architecture:** Pure structural refactor + a docs addition. No behavior change, no new tests of
behavior. Verification per batch = `yarn typecheck` + `yarn test` + (final) `yarn workspace
@atizar/react build` stay green. Component files move from a flat `components/Name.tsx` +
`components/Name.module.scss` layout into a folder-per-component layout
`components/Name/Name.tsx` + `components/Name/Name.module.scss` (+ co-located test). Imports use
`.js` ESM specifiers (NodeNext) — every move updates the barrel `src/index.ts` and all importers.

**Tech Stack:** React + TypeScript, Vite library build (`@atizar/react`), Vitest, SCSS modules
(`localsConvention: 'camelCaseOnly'`), yarn-classic workspace.

**Key facts (from the structural map):**
- `@atizar/react` build entry is a SINGLE `src/index.ts`; `dts` uses `include: ['src']`; tsconfig
  `include: ['src']`; vitest globs are recursive (`packages/*/src/**/*.test.{ts,tsx}`,
  `apps/inbox/**/*.test.{ts,tsx,mjs}`). → Folder moves DO NOT touch build/test config; they only
  break cross-file imports + the barrel. Fix those and green is restored.
- Imports use `.js` extension specifiers (e.g. `import { AgentCard } from './AgentCard.js'`). After a
  move, `'./components/AgentCard.js'` → `'./components/AgentCard/AgentCard.js'`, and a sibling import
  inside the same old `components/` dir (e.g. AgentGrid → AgentCard) changes from `'./AgentCard.js'`
  to `'../AgentCard/AgentCard.js'`.
- `localsConvention: 'camelCaseOnly'` is set in BOTH `packages/react/vite.config.ts` (lib build) AND
  `apps/inbox/vite.config.ts` (dev) — do not touch either; moves keep the same convention.

**The package component/primitive inventory to folderize** (flat today, all under
`packages/react/src/`):
- `components/`: `ActivityPanel`, `AgentCard`, `AgentGrid` (no scss), `AgentModal`, `AppHeader`,
  `ConnectionChip`, `Connections`, `Icon` (no scss), `InstancePickerModal`, `PipelineColumn`,
  `ThreadModal` (no scss), `WorkflowTabs`, `WorkflowSwitcher` (no scss). Co-located tests:
  `AgentGrid.test.tsx`, `Connections.test.tsx`.
- `primitives/`: `Button`, `CompHeader`, `ConfirmDialog`, `Drawer`, `IconButton`, `Modal`,
  `Segmented`, `StopButton`, `Switch` (+ `primitives/index.ts` re-export barrel).
- Root-level model/util/hook files (`aggregate.ts`, `boardModel.ts`, `pipelineModel.ts`,
  `status.ts`, `lookups.ts`, `hooks/*`, etc.) STAY where they are — folder-per-component is for
  COMPONENTS only. Rule 2 explicitly keeps shared helpers/hooks at the package top level.

---

## Task 1: Write the conventions doc section

**Files:**
- Modify: `docs/CONVENTIONS.md` (add a new section after "## Components", before "## Hooks")

- [ ] **Step 1: Add the "Component file & folder structure" section**

Insert this section into `docs/CONVENTIONS.md` immediately after the existing "## Components"
section (which already states the arrow-const/named-export/one-component-per-file/Props rules) and
before "## Hooks". It deepens "one component per file" with folder-per-component + CSS-Modules-
everywhere:

```markdown
## Component file & folder structure

These extend the one-component-per-file rule above with where a component's files live.

1. **One component per file — including private wrappers.** A file exports exactly one React
   component (plus its own `Props` type). No second component in the same file — not even a small
   private `Inner`/wrapper. Extract it to its own file. (Pure non-component helpers/hooks may live
   beside it per rule 2.)
2. **Folder per component.** A component lives in its own folder named for it:
   `ComponentName/ComponentName.tsx` + `ComponentName/ComponentName.module.scss` (its styles) + any
   component-local helpers / hooks / sub-components / tests in that same folder
   (`ComponentName.test.tsx`, `useComponentNameThing.ts`, …). A barrel `index.ts` is optional —
   prefer importing the file directly (`./ComponentName/ComponentName.js`). Truly shared
   helpers/hooks stay at the package top level (`hooks/`, models like `boardModel.ts`) — folder
   locality is for things used ONLY by that component.
3. **CSS Modules everywhere, including `apps/`.** Every component (package AND userland) owns its
   styles in a co-located `*.module.scss`. No component-specific rules in a global stylesheet. The
   only global CSS is the reset + cross-cutting layout shells + the `--atz-*` token layer
   (`tokens.css`). Import class names from the module (`import s from './X.module.scss'`) and merge
   an incoming `className` with `clsx`. Note `localsConvention: 'camelCaseOnly'` camelizes BOTH `-`
   AND `_` (`.card-top` → `cardTop`, `awaiting_approval` → `awaitingApproval`); a runtime
   status-keyed class needs a `camelize()` helper, and the convention must match in every Vite
   config that compiles the package's `*.module.scss` (the demo's `apps/inbox/vite.config.ts` and
   `packages/react/vite.config.ts`).
```

- [ ] **Step 2: Verify the doc reads cleanly**

Run: `yarn format:check docs/CONVENTIONS.md 2>/dev/null || true` (markdown isn't Prettier-gated; just
re-read the file to confirm the section is well-formed and the surrounding headings are intact).
Expected: section present, "## Components" still above it, "## Hooks" still below it.

- [ ] **Step 3: Commit**

```bash
git add docs/CONVENTIONS.md
git commit -m "docs(conventions): add component file & folder structure rules"
```

---

## Task 2: Split `BoardApp.tsx` into one-component-per-file

`apps/inbox/client/src/BoardApp.tsx` holds TWO components: the private `Inner` (lines 32–201, the
real composition) and the exported `BoardApp` wrapper (lines 203–207, wraps `Inner` in
`WorkflowsProvider`). Per rule 1, extract `Inner` into its own file. Apply folder-per-component
(rule 2) to both.

**Files:**
- Create: `apps/inbox/client/src/BoardApp/BoardApp.tsx` (the wrapper)
- Create: `apps/inbox/client/src/BoardApp/BoardInner.tsx` (the former `Inner`, renamed `BoardInner`)
- Delete: `apps/inbox/client/src/BoardApp.tsx`
- Modify: `apps/inbox/client/src/App.tsx` (importer of `BoardApp`) — verify/fix the import path

- [ ] **Step 1: Find every importer of `BoardApp`**

Run: `grep -rn "BoardApp" apps/inbox/client/src --include=*.tsx --include=*.ts`
Expected: `App.tsx` imports `BoardApp` (and the file itself). Note the exact import line in `App.tsx`.

- [ ] **Step 2: Create `BoardInner.tsx`**

Create `apps/inbox/client/src/BoardApp/BoardInner.tsx` containing the former `Inner`, renamed to
`BoardInner`, exported (named, arrow-const), with a proper `BoardInnerProps` type (rule from
CONVENTIONS — no inline anonymous props). Move the explanatory comment block (current lines 28–31)
above it. The body is verbatim the current `Inner` body (lines 33–200). Imports: copy the
`@atizar/core` + `@atizar/react` imports it needs (everything except `WorkflowsProvider`, which only
the wrapper uses), plus `useState` from `react`.

```tsx
import { useState } from 'react'
import { instanceId } from '@atizar/core'
import {
  AppHeader,
  PipelineColumn,
  AgentGrid,
  ThreadModal,
  AgentModal,
  InstancePickerModal,
  ActivityPanel,
  ConfirmDialog,
  useBoard,
  useHealth,
  useActivity,
  useDispatch,
  useWorkflowSelection,
  useBoardNavigation,
  useStopController,
  buildPipeline,
  queuedByAgent,
  statusesOf,
  aggregateAgent,
  isDevMode,
  type WorkflowsConfig,
} from '@atizar/react'

// BoardInner is the reference composition: the former WorkflowBoard monolith, now assembled
// in userland from @atizar/react blocks + orchestration hooks. Behavior- and DOM-identical
// to the old board — orchestration comes from the three hooks (useWorkflowSelection /
// useBoardNavigation / useStopController) and the JSX lives here.
type BoardInnerProps = {
  config: WorkflowsConfig
  demo?: boolean
}

export const BoardInner = ({ config, demo }: BoardInnerProps) => {
  // ... verbatim body of the current `Inner` (lines 33–200 of the old BoardApp.tsx) ...
}
```

(Copy the ENTIRE body — `useBoard()` through the closing `</div>` and `)` — unchanged. Do not
abbreviate; the only edits are the component name and the `Props` type.)

- [ ] **Step 3: Create `BoardApp.tsx` (the wrapper) in the folder**

Create `apps/inbox/client/src/BoardApp/BoardApp.tsx`:

```tsx
import { WorkflowsProvider, type WorkflowsConfig } from '@atizar/react'
import { BoardInner } from './BoardInner'

type BoardAppProps = {
  config: WorkflowsConfig
  demo?: boolean
}

export const BoardApp = ({ config, demo }: BoardAppProps) => (
  <WorkflowsProvider config={config}>
    <BoardInner config={config} demo={demo} />
  </WorkflowsProvider>
)
```

- [ ] **Step 4: Delete the old flat file and fix the importer**

```bash
git rm apps/inbox/client/src/BoardApp.tsx
```

Update `App.tsx`'s import of `BoardApp` from `'./BoardApp'` to `'./BoardApp/BoardApp'` (verify the
exact old specifier from Step 1; Vite resolves extensionless app imports, so no `.js` needed here —
match the existing style in `App.tsx`).

- [ ] **Step 5: Typecheck + test**

Run: `yarn typecheck && yarn test`
Expected: PASS (no behavior change; the board composition is identical).

- [ ] **Step 6: Commit**

```bash
git add apps/inbox/client/src/BoardApp App.tsx apps/inbox/client/src/App.tsx
git commit -m "refactor(inbox): split BoardApp into BoardApp + BoardInner (one component per file)"
```

---

## Task 3: Folderize `@atizar/react` primitives

Move the 9 primitives from flat `primitives/Name.tsx` + `Name.module.scss` into
`primitives/Name/Name.tsx` + `primitives/Name/Name.module.scss`. Keep `primitives/index.ts` at the
top of `primitives/` (it's a shared barrel, not a component) and repoint its specifiers.

**Files (per primitive `Name` in {Button, CompHeader, ConfirmDialog, Drawer, IconButton, Modal,
Segmented, StopButton, Switch}):**
- Move: `primitives/Name.tsx` → `primitives/Name/Name.tsx`
- Move: `primitives/Name.module.scss` → `primitives/Name/Name.module.scss`
- Modify: `primitives/index.ts`, `src/index.ts`, and every importer of the moved primitive

- [ ] **Step 1: Map current primitive imports**

Run:
```bash
grep -rn "from '.*primitives/\(Button\|CompHeader\|ConfirmDialog\|Drawer\|IconButton\|Modal\|Segmented\|StopButton\|Switch\)" packages/react/src
grep -rn "from './\(Button\|CompHeader\|ConfirmDialog\|Drawer\|IconButton\|Modal\|Segmented\|StopButton\|Switch\)" packages/react/src/primitives
```
Expected: a list of importers — `src/index.ts`, `primitives/index.ts`, and cross-primitive imports
(e.g. a primitive that imports `Button`). Note them.

- [ ] **Step 2: Move the files with `git mv`**

For each primitive (run all 18 moves):
```bash
cd packages/react/src/primitives
for n in Button CompHeader ConfirmDialog Drawer IconButton Modal Segmented StopButton Switch; do
  mkdir -p "$n"
  git mv "$n.tsx" "$n/$n.tsx"
  git mv "$n.module.scss" "$n/$n.module.scss"
done
```

(`Button` has a co-located `.module.scss`; all 9 do per the inventory. If any `git mv` fails because
a `.module.scss` doesn't exist, drop that line — verify with `ls` first.)

- [ ] **Step 3: Fix the SCSS import inside each moved `.tsx`**

Each `Name/Name.tsx` imports `'./Name.module.scss'` — that specifier is STILL correct after the move
(the scss moved alongside into the same folder). No change needed unless a primitive imported a
sibling primitive; fix those: a sibling import `'./Button.js'` becomes `'../Button/Button.js'`.

- [ ] **Step 4: Repoint `primitives/index.ts`**

Update every `export … from './Name.js'` to `export … from './Name/Name.js'` in
`packages/react/src/primitives/index.ts`.

- [ ] **Step 5: Repoint `src/index.ts`**

Update the primitive exports (lines ~38–45) from `'./primitives/Name.js'` to
`'./primitives/Name/Name.js'`.

- [ ] **Step 6: Fix any other importers found in Step 1**

For each remaining importer outside `primitives/`, update its specifier to the new nested path.

- [ ] **Step 7: Typecheck + test**

Run: `yarn typecheck && yarn test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/react/src
git commit -m "refactor(react): folderize primitives (folder-per-component)"
```

---

## Task 4: Folderize `@atizar/react` components — batch A (leaf/low-fanout)

Do the components with the fewest internal importers first to keep each typecheck small. Batch A:
`Icon`, `ConnectionChip`, `Connections`, `WorkflowSwitcher`, `WorkflowTabs`. (`Icon` and
`WorkflowSwitcher` have no `.module.scss`; `Connections` has a co-located `Connections.test.tsx`.)

**Files (per component `Name`):**
- Move: `components/Name.tsx` → `components/Name/Name.tsx`
- Move (if exists): `components/Name.module.scss` → `components/Name/Name.module.scss`
- Move (if exists): `components/Name.test.tsx` → `components/Name/Name.test.tsx`
- Modify: `src/index.ts` + every importer

- [ ] **Step 1: Map importers for batch A**

Run:
```bash
grep -rn "from '.*\(Icon\|ConnectionChip\|Connections\|WorkflowSwitcher\|WorkflowTabs\)\.js'" packages/react/src
grep -rln "components/\(Icon\|ConnectionChip\|Connections\|WorkflowSwitcher\|WorkflowTabs\)" packages/react/src
```
Note importers (e.g. many components import `Icon`; `AppHeader` imports `WorkflowTabs`;
`Connections` imports `ConnectionChip`).

- [ ] **Step 2: Move the files**

```bash
cd packages/react/src/components
for n in Icon ConnectionChip Connections WorkflowSwitcher WorkflowTabs; do
  mkdir -p "$n"
  git mv "$n.tsx" "$n/$n.tsx"
  [ -f "$n.module.scss" ] && git mv "$n.module.scss" "$n/$n.module.scss"
  [ -f "$n.test.tsx" ] && git mv "$n.test.tsx" "$n/$n.test.tsx"
done
```

- [ ] **Step 3: Fix imports inside the moved files**

In each moved `Name/Name.tsx` / `Name/Name.test.tsx`:
- `'./Name.module.scss'` → unchanged (moved alongside).
- A sibling-component import (e.g. `Connections` → `'./ConnectionChip.js'`) becomes
  `'../ConnectionChip/ConnectionChip.js'`.
- An import of a still-flat sibling (e.g. `'./Icon.js'` from a NOT-yet-moved component) — those live
  in the OTHER direction; handle when you touch the importer. Within batch A, `Connections` →
  `ConnectionChip` and any `→ Icon` references move to `'../Icon/Icon.js'`.
- A primitive import `'../primitives/Button.js'` → `'../primitives/Button/Button.js'` (already moved
  in Task 3 — confirm specifiers match).
- A model/hook import (`'../boardModel.js'`, `'../hooks/useX.js'`) becomes `'../../...'` because the
  file is now one level deeper: `'../boardModel.js'` → `'../../boardModel.js'`,
  `'../../hooks/...'` if it referenced `'../hooks/...'`. **Watch the depth increase: a component
  moving from `components/Name.tsx` to `components/Name/Name.tsx` gains ONE `../` for every
  non-co-located import.**

- [ ] **Step 4: Repoint `src/index.ts` for batch A**

`'./components/Icon.js'` → `'./components/Icon/Icon.js'`, same for ConnectionChip, Connections,
WorkflowSwitcher, WorkflowTabs.

- [ ] **Step 5: Fix external importers found in Step 1**

Update every other file that imports a batch-A component (e.g. files importing `Icon` from
`'./components/Icon.js'` → `'./components/Icon/Icon.js'`; a component still flat in `components/`
importing `'./Icon.js'` → `'./Icon/Icon.js'`).

- [ ] **Step 6: Typecheck + test**

Run: `yarn typecheck && yarn test`
Expected: PASS (Connections.test + Icon consumers compile).

- [ ] **Step 7: Commit**

```bash
git add packages/react/src
git commit -m "refactor(react): folderize components batch A (Icon, Connections, ConnectionChip, WorkflowSwitcher, WorkflowTabs)"
```

---

## Task 5: Folderize `@atizar/react` components — batch B (cards/panels)

Batch B: `AgentCard`, `AgentGrid`, `AgentModal`, `PipelineColumn`, `InstancePickerModal`.
(`AgentGrid` has no `.module.scss` and a co-located `AgentGrid.test.tsx`.)

**Files:** same move pattern as Task 4 (`components/Name.tsx` → `components/Name/Name.tsx`, scss +
test alongside).

- [ ] **Step 1: Map importers**

Run:
```bash
grep -rn "from '.*\(AgentCard\|AgentGrid\|AgentModal\|PipelineColumn\|InstancePickerModal\)\.js'" packages/react/src
```
Note: `AgentGrid` imports `AgentCard`; `ThreadModal`/`AgentModal` relationships; `index.ts` exports.

- [ ] **Step 2: Move the files**

```bash
cd packages/react/src/components
for n in AgentCard AgentGrid AgentModal PipelineColumn InstancePickerModal; do
  mkdir -p "$n"
  git mv "$n.tsx" "$n/$n.tsx"
  [ -f "$n.module.scss" ] && git mv "$n.module.scss" "$n/$n.module.scss"
  [ -f "$n.test.tsx" ] && git mv "$n.test.tsx" "$n/$n.test.tsx"
done
```

- [ ] **Step 3: Fix imports inside the moved files**

Apply the same rules as Task 4 Step 3: scss specifier unchanged; sibling-component imports gain a
`../Name/` hop (e.g. `AgentGrid` → `'./AgentCard.js'` becomes `'../AgentCard/AgentCard.js'`); Icon
import → `'../Icon/Icon.js'` (Icon moved in batch A); primitive imports →
`'../primitives/Name/Name.js'`; model/hook imports gain one `../`.

- [ ] **Step 4: Repoint `src/index.ts` for batch B**

- [ ] **Step 5: Fix external importers**

(e.g. `ThreadModal` may import `AgentModal`; `BoardInner` in the demo imports these from
`@atizar/react` by package name — NOT affected.)

- [ ] **Step 6: Typecheck + test**

Run: `yarn typecheck && yarn test`
Expected: PASS (AgentGrid.test compiles).

- [ ] **Step 7: Commit**

```bash
git add packages/react/src
git commit -m "refactor(react): folderize components batch B (AgentCard, AgentGrid, AgentModal, PipelineColumn, InstancePickerModal)"
```

---

## Task 6: Folderize `@atizar/react` components — batch C (chrome + thread)

Batch C: `AppHeader`, `ActivityPanel`, `ThreadModal`. (`ThreadModal` has no `.module.scss` — it uses
the global `styles.css`; that's WS-out-of-scope here, leave its styling as-is, just move the `.tsx`
into a folder.)

- [ ] **Step 1: Map importers**

Run:
```bash
grep -rn "from '.*\(AppHeader\|ActivityPanel\|ThreadModal\)\.js'" packages/react/src
```

- [ ] **Step 2: Move the files**

```bash
cd packages/react/src/components
for n in AppHeader ActivityPanel ThreadModal; do
  mkdir -p "$n"
  git mv "$n.tsx" "$n/$n.tsx"
  [ -f "$n.module.scss" ] && git mv "$n.module.scss" "$n/$n.module.scss"
done
```

- [ ] **Step 3: Fix imports inside the moved files**

Same rules. `AppHeader` imports `WorkflowTabs` (batch A, now `'../WorkflowTabs/WorkflowTabs.js'`) and
likely `Icon`/primitives. `ThreadModal` imports `AgentModal` (batch B,
`'../AgentModal/AgentModal.js'`), the global `styles.css` reference is via class strings (no import)
— leave it; and any `useGate`/model/hook import gains one `../`.

- [ ] **Step 4: Repoint `src/index.ts` for batch C**

- [ ] **Step 5: Fix external importers**

- [ ] **Step 6: Typecheck + test + build**

Run: `yarn typecheck && yarn test && yarn workspace @atizar/react build`
Expected: PASS. The build is the real proof the dts rollup + CSS module collection survive the moves.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src
git commit -m "refactor(react): folderize components batch C (AppHeader, ActivityPanel, ThreadModal)"
```

---

## Task 7: Full green gate + lint/format

- [ ] **Step 1: Run the full gate**

Run: `yarn typecheck && yarn test && yarn lint && yarn format:check`
Expected: all PASS. If `format:check` flags moved files, run `yarn format` on them and re-check.

- [ ] **Step 2: Build the package**

Run: `yarn workspace @atizar/react build`
Expected: PASS — `dist/index.js`, rolled `dist/index.d.ts`, and the compiled `react.css` (with
`--atz-*` tokens + module classes) all emit.

- [ ] **Step 3: Commit any format fixes**

```bash
git add -A
git commit -m "chore(react): format after folderization" || echo "nothing to format"
```

---

## Browser verification (after Task 7, before merge)

Use the `browser-verify` skill. The bug class here is "hashed CSS-module classes silently fail to
resolve after a move" — only the browser catches it. With `DEV_RECORD_REPLAY=1` and the lead-inbox
cassettes:
1. Board loads and is FULLY STYLED (status dots, pills, agent cards, pipeline column — the moved
   `.module.scss` classes resolve, nothing unstyled).
2. Open a work item → ThreadModal renders; cards appear styled.
3. Status dots/pills show color (the `camelize()` status-keyed classes still resolve — the
   camelCaseOnly gotcha).
4. No console errors about missing modules / failed imports.

If anything is unstyled or a class is missing, that's a move that dropped a `.module.scss` import —
fix and re-verify.

---

## Self-review checklist (run before merge)

- **Spec coverage:** (1) conventions written → Task 1; (2) BoardApp split (one component per file) →
  Task 2; (3) package components folderized → Tasks 3–6; (4) userland card scss migration → DEFERRED
  to WS3 (correct, per spec). ✓
- **No behavior change:** every task ends green on typecheck+test; the final build + browser verify
  prove the package still emits and renders.
- **Depth gotcha:** the single most common break is forgetting that a component moving one level
  deeper needs an extra `../` on every non-co-located import (models, hooks, sibling components,
  primitives). Grep after each batch: `yarn typecheck` will catch unresolved specifiers.
- **camelCaseOnly:** unchanged in both vite configs — confirm neither was edited.
