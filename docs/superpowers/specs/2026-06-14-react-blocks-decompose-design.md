# `@atizar/react` — Block Library Decomposition + Styling + Publish Build — Design

**Status:** design in progress (brainstormed with the developer 2026-06-14). Turns `@atizar/react`
from a take-it-or-fork monolith into a flexible, **publishable** block library. Touches packaging
conventions (`check-foundation` to run at implementation — see Foundation). Supersedes the
`WorkflowBoard`-as-the-entry-point shape from the 7b extraction spec
(`2026-06-10-extract-platform-react-design.md`).

## Problem

`@atizar/react` was meant to be layered (headless hooks + primitives + chrome + card kit — per the
beta decisions). The layering is half-built, and the ergonomic surface collapsed to one monolith:

- **One 403-line `WorkflowBoard.tsx`** is the only real entry point. It holds **~170 lines of
  orchestration** (`WorkflowBoard.tsx:43-214`): active-workflow selection, open/picker navigation +
  URL sync, the Stop-confirm flow, cross-workflow "new arrivals" badges, and the
  `board.items → pipeline` derivation. None of it is reusable.
- **The mid-tier blocks are not exported.** `PipelineColumn`, `AgentCard`, `AgentModal`,
  `ThreadModal`, `InstancePickerModal`, `WorkflowSwitcher` live in `components/` but are absent from
  `index.ts`. A consumer gets two extremes: take all of `WorkflowBoard`, or rebuild from raw hooks.
  Recomposing a board from the existing blocks = fork.
- **Styling is a 3969-line global `styles.css`** with global class names (`.agent-card`, `.card-top`,
  `.status`, `.dot`) — collision-prone, zero encapsulation.
- **Tokens exist but are unstructured:** 29 custom properties, **unprefixed** (`--bg`, `--surface`,
  `--text`, `--teal`, `--amber-bg`, `--r`, `--sidebar-w`…), flat, mixing raw palette + semantics +
  component sizing in one `:root`. (The docs claim a namespaced `--atz-*` + a separate `tokens.css`;
  neither exists — a doc overclaim to fix.)
- **No build step.** `exports` point at `./src/*`; the only consumer is the in-monorepo demo, whose
  Vite transpiles source directly. This is **incompatible with the stated npm-publish goal** — raw
  `.scss`/CSS-Modules source cannot be relied on to compile in an arbitrary consumer's bundler.

## Goal

Three public tiers, no monolith, publishable:

1. **Headless hooks** — small, single-purpose, the reusable "brain" (variant A).
2. **Composable blocks** — every visual piece exported, plain-props, no hidden state.
3. **A thin demo composition** in `apps/inbox` that wires #1 + #2 — the reference for "build your own
   board," not a black box. **`WorkflowBoard` is deleted.**

Plus: a structured `--atz-*` token system, co-located `*.module.scss`, and a real Vite **lib build**
so `npm i @atizar/react` works with zero bundler config on the consumer side.

## 1. Headless hooks (the brain, extracted from `BoardInner`)

Three focused hooks in `@atizar/react/hooks/`, each with one purpose, plus the existing pure models
promoted to public helpers. **No bundling "god hook"** (YAGNI; the demo composition is the
one-liner reference). The existing low-level data hooks (`useBoard`, `useDispatch`, `useGate`,
`useWorkItemThread`, `useActivity`, `useHealth`, `useConnections`) are unchanged.

- **`useWorkflowSelection(config)`** — active workflow + cross-workflow signals.
  Owns: `activeWorkflowId`, `setActiveWorkflowId`/`switchWorkflow(id)`, the `seenRef` for
  cross-workflow children, `unread` badge map, `globalActive`/`workflowActiveCount` counts. Depends
  on `useBoard()` for `items`.
- **`useBoardNavigation(config, activeWorkflowId)`** — what's open.
  Owns: `openId`/`openTypeId`/`openPickerId`, `openAgent(agentId)`, `startInput(def)` → open, the
  `?open=` URL sync effect, and resolution of `openItem`/`openTypeAgent`/`pickerInstances` +
  `notesFor(id)`. Depends on `useBoard()`, `useDispatch().start`, and the `lookups` helper.
- **`useStopController()`** — the Stop/cancel flow.
  Owns: `confirm` state, `stoppingItems`/`stoppingWorkflow`/`stoppingAll`, `confirmStop()` wired to
  `cancel`/`cancelWorkflow`/`cancelAll` from `useDispatch()`. Returns request helpers
  (`requestStopItem(id)` / `requestStopWorkflow()` / `requestStopAll()`) + the confirm/stopping state
  the `ConfirmDialog` block needs.

**Pure helpers promoted to public exports** (already pure functions, just export them): `buildPipeline`,
`toPInstances`, `queuedByAgent`, `statusesOf`, `aggregateAgent`, `aggregateLabel`, plus a new
**`lookups(config, activeWorkflowId)`** factory that returns `defOf/roleOf/nameOf/metaIcon/stripAgent/
labelOf` (today these are closures inside `BoardInner`; extracting them de-duplicates use across the
hooks and the demo). The `board.items → blocks` derivation stays a plain call
(`buildPipeline(toPInstances(...), queuedByAgent(...))`) the demo makes — not hidden in a hook.

## 2. Exported blocks

Newly exported from `index.ts` (already built, currently package-internal): **`PipelineColumn`,
`AgentCard`, `AgentModal`, `ThreadModal`, `InstancePickerModal`, `WorkflowSwitcher`**, plus a new thin
**`AgentGrid`** (extracted from the inline `workflow.agents.map(...)` JSX in `WorkflowBoard`, props:
agents + per-agent state + `onStart`/`onOpen`). Already exported and kept: `AppHeader`, `WorkflowTabs`,
`ActivityPanel`, `Connections`, `ConnectionChip`, `Icon`, all primitives, all hooks. Each block stays
**plain-props / no embedded orchestration** — it renders what it's given and calls back. `WorkflowsProvider`
/ `useWorkflowsConfig` and the spec-render machinery (`buildRenderToolCall`, `RenderSpec`/`HitlSpec`,
`threadResults`) are unchanged.

**Deleted:** `WorkflowBoard.tsx`. Its JSX composition moves to the demo (§3); its logic becomes §1.

## 3. Demo composition (the reference)

`apps/inbox/client/src/` gains a `BoardApp.tsx` (~50-70 lines): mount `WorkflowsProvider`, call the
three hooks + `useBoard`/`useHealth`/`useActivity`, derive `blocks`/agents via the public helpers, and
lay out the exported blocks (`AppHeader`, `PipelineColumn`, `AgentGrid`, `ThreadModal`/`AgentModal`/
`InstancePickerModal`, `ActivityPanel`, `ConfirmDialog`). This is the former `BoardInner` body, now in
userland — the worked example a consumer copies and rearranges. `App.tsx` renders `<BoardApp
config={workflowsConfig} />`.

## 4. Styling

- **Co-located CSS Modules:** each block gets `Block.module.scss` beside `Block.tsx`; `import s from
  './Block.module.scss'`; class names are hashed → scoped, no collisions, co-located. `.scss` for
  nesting/`@use` (sass = a dev-dep, compiled at build — see §6).
- **`className` passthrough kept** as the escape hatch: blocks merge `clsx(s.root, props.className)`.
- **Migration is incremental, block-by-block, alongside §2** — not a separate big-bang rewrite. As each
  block is exported, its slice of `styles.css` moves into its `.module.scss`. The global `styles.css`
  shrinks to a small `base.css` (reset + element defaults) and disappears as blocks migrate.

## 5. Token taxonomy (`tokens.css`, `--atz-*`, two tiers)

One file, `src/tokens.css`, `:root` only. **Defaults are bundled into the shipped CSS** so it works with
zero extra import; customization = the consumer redefines any `--atz-*` in their own CSS (custom
properties cascade — no import of our file required). `tokens.css` is *also* exported (`./tokens.css`)
as an optional reference / theme base.

- **Tier 1 — primitives** (raw scale; components never reference directly): palette
  (`--atz-teal-500`, `--atz-amber-300`, `--atz-grey-50…900`, …), `--atz-space-1…8`,
  `--atz-radius-sm|md|lg|xl`, `--atz-shadow-1|2|modal`, `--atz-font-sans`, sizes (`--atz-size-sidebar`).
- **Tier 2 — semantic** (reference Tier 1; the ONLY layer components use):
  `--atz-color-bg|surface|text|text-muted|border|border-strong|accent|accent-ink|accent-tint|danger`,
  and board statuses `--atz-status-running|awaiting|error|idle|done` (one source for both the dots and
  the badges).
- Naming: `--atz-<category>-<role>[-<variant>]`. Components write only `var(--atz-color-text)`,
  `var(--atz-space-3)`, `var(--atz-status-awaiting)`. Rebrand = override Tier 2; dark theme (later) =
  Tier 2 under `[data-theme="dark"]`; consumer branding = same mechanism. The current 29 vars map
  cleanly (e.g. `--teal → --atz-teal-500`/`--atz-color-accent`, `--bg → --atz-color-bg`,
  `--r-lg → --atz-radius-lg`, `--sidebar-w → --atz-size-sidebar`).

## 6. Build & packaging (publish-ready)

**Reverse the "no build step" convention for publishable packages.** It was a monorepo shortcut valid
only while the sole consumer was the local Vite app; it is incompatible with npm publication of a
styled, CSS-Modules library.

- **Vite library mode** per publishable package: `build.lib` (multiple entries for subpath exports),
  `vite-plugin-dts` for `.d.ts`, `sass` dev-dep, `rollupOptions.external` for peers (`react`,
  `react-dom`, `@atizar/*` siblings). Output → `dist/`: ESM JS (hashed class names inlined) +
  a bundled `styles.css` (compiled from all `.module.scss` + the Tier-1/2 token defaults) + types.
- **`package.json.exports` → `dist/`** for the published artifact (`.` → `dist/index.js` + `dist/
  index.d.ts`; `./styles.css` → `dist/styles.css`; `./tokens.css` → `dist/tokens.css`); add `files`,
  `sideEffects: ["*.css"]`, drop `private: true` when publishing.
- **Dev stays fast:** in the monorepo the demo can keep consuming source (Vite + sass handle
  `.module.scss` in dev with HMR); the build runs for the npm artifact (`prepublishOnly` / CI). Pick
  one of: dev resolves to `src` via a conditional `exports`/workspace alias, or run `vite build --watch`.
  Decide in the plan.
- `@atizar/react` is the first package converted (it has the CSS). The other publishable packages
  (`core`, `providers`, `integrations`, `server`) adopt the same lib-build pattern when each is
  published; this spec implements it for `react` and documents the pattern.

## Foundation conditions

- **Belief #3 strengthened** (more composable, more physical framework/userland boundary); **I5
  intact** (userland still imports only the public surface — now a richer one). **`@atizar/core` stays
  React-free.** **Cards stay in userland** (unchanged from 7b). **No invariant I1-I15 is touched.**
- **"No build step" is a packaging convention, not an invariant** — changing it is allowed, but update
  `CLAUDE.md` ("No build step" line) and `ARCHITECTURE.md` §8 (Packaging) in the same change, and run
  the `check-foundation` skill at implementation (it touches packaging + the framework/userland
  boundary). Expected verdict: CLEAR (this realizes belief #3, doesn't erode it).

## Scope / YAGNI (explicitly NOT in this work)

- No dark theme shipped (tokens *enable* it; building it is later).
- No new card-kit features; no consumer-auth / identity work (separate roadmap items).
- No bundling "god hook"; no slots/compound-component API (the exported blocks + demo composition are
  the flexibility; add `slots` later only if a real consumer needs single-region override of a default
  composition we don't yet ship).
- Lib-build implemented for `@atizar/react` only; other packages follow the documented pattern when
  published.

## Phasing (one coherent design, sequenced by the plan)

1. **Tokens** — add `src/tokens.css` (Tier 1/2, `--atz-*`), point the existing `styles.css` at the new
   vars (no behavior change, contained). Fix the `--atz-*`/`tokens.css` doc claims.
2. **Decomposition** — extract the three hooks + `lookups`; export all blocks + `AgentGrid`; delete
   `WorkflowBoard`; build `apps/inbox/client/src/BoardApp.tsx`. Behavior-preserving.
3. **Styling migration** — move each block's CSS into its `.module.scss` (interleaves with step 2 per
   block); shrink `styles.css` to `base.css`.
4. **Publish build** — Vite lib mode + `vite-plugin-dts` + sass; `exports → dist`; update CLAUDE.md /
   ARCHITECTURE §8.

## Risks / what only the browser catches

- **Unstyled defaults:** if the Tier-1/2 token defaults aren't bundled into the shipped CSS, components
  render unstyled (var lookups resolve to nothing). Browser-verify the demo with a clean import.
- **Provider mounting:** blocks/threads read `useWorkflowsConfig()`; if `WorkflowsProvider` isn't above
  them in the demo composition, render/gate cards silently no-op (same class as 7b). Browser-verify the
  full lead-inbox flow.
- **Hook extraction parity:** the open/picker/stop/URL-sync behavior must match the old `BoardInner`
  exactly (singleton START disable, reload re-attach via `?open=`, Stop-confirm). Cover with the
  existing model unit tests + a browser E2E.
- **CSS-Modules class merge:** a block that drops `props.className` breaks consumer overrides
  (invisible to typecheck). Lint/review for the `clsx(s.root, className)` pattern.
- **Lib-build externalization:** failing to externalize `react` double-bundles it → hook errors in the
  consumer. Verify the built artifact imports, not just the dev path.

## Definition of done

Typecheck + tests + lint + build + format(my files) green; `check-foundation` CLEAR; `WorkflowBoard`
deleted and `@copilotkit` still absent; all blocks + 3 hooks + pure helpers exported; `tokens.css`
(`--atz-*`, 2 tiers) shipped + bundled defaults; at least the migrated blocks on `.module.scss`; a
working **`vite build` lib artifact** for `@atizar/react` (ESM + `.d.ts` + compiled `styles.css`) with
`exports → dist`; CLAUDE.md / ARCHITECTURE §8 updated (no-build-step reversed; `--atz-*` token claim now
true); browser E2E of the lead-inbox flow through the recomposed demo (board, run, render cards, approve
WITH edit → Gmail draft, reject, cancel, reload re-attach).
