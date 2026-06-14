# `@atizar/react` Styling Modules + Publish Build (Plan B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dismantle the 3969-line global `styles.css` into co-located `*.module.scss` per block, and add a Vite **library build** so `@atizar/react` publishes to npm as a compiled artifact (ESM + `.d.ts` + bundled CSS) consumable with zero bundler config.

**Architecture:** Phase 3 = per-block CSS-Module migration (a precise, repeatable, grep-driven procedure; styles stay token-driven via `var(--atz-*)`; `className` passthrough kept via `clsx`). Phase 4 = `vite build --lib` + `vite-plugin-dts` + `sass`; conditional `exports` so monorepo dev still resolves `src` (fast HMR) while published consumers get `dist`. Reverses the "no build step" convention (docs updated).

**Tech Stack:** TypeScript, React 19, Vite library mode, `vite-plugin-dts`, `sass`, CSS Modules, vitest.

**Prerequisite:** Plan A landed (`feat/react-blocks-decompose`) — blocks exported, `tokens.css` exists with `--atz-*`, `WorkflowBoard` deleted, board composed in `apps/inbox/client/src/BoardApp.tsx`. This plan continues on the same branch.

**Run from repo root:** `yarn test`, `yarn typecheck`, `yarn lint`, `yarn workspace @atizar/react build` (added in Phase 4).

---

## Important truth about the current CSS

`packages/react/src/styles.css` (~3969 lines) holds global class rules for every block plus the `@import './tokens.css'` + legacy var aliases (added in Plan A). The migration **moves existing rules** — it does not rewrite styling. Do not invent CSS; cut the matching rules from `styles.css` and paste them into the block's module. Verify visually (browser) after each block — class scoping is the only change, the rendered result must be pixel-identical.

**What stays global (a small `base.css`):** the CSS reset (`*`, `box-sizing`, `body`, element defaults), the board layout shells consumed by the userland `BoardApp` (`.app`, `.workspace-body`, `.main`, `.main-scroll`, `.agent-grid`, `.legend`), and any genuinely cross-cutting utility. Everything block-specific moves into that block's module.

---

## File Structure

**Phase 3 (per block, in `packages/react/src/`):**
- Create: `components/<Block>.module.scss` (one per migrated block) + `primitives/<Prim>.module.scss`.
- Modify: each `<Block>.tsx` — `import s from './<Block>.module.scss'`; `className='foo'` → `className={s.foo}`; conditional/compound → `clsx(s.foo, cond && s.bar, props.className)`.
- Modify: `styles.css` — shrinks as rules move out; finally rename remainder to `base.css`.
- Add: `clsx` dependency (tiny) if not present.

**Phase 4:**
- Create: `packages/react/vite.config.ts` (library build).
- Modify: `packages/react/package.json` (build script, conditional `exports`, `files`, `sideEffects`, devDeps).
- Modify: root `package.json` if a top-level `build` should fan in the package build.
- Modify: `CLAUDE.md`, `docs/ARCHITECTURE.md` §8 (reverse "no build step").

---

## Phase 3 — CSS Module migration

### Task 1: Tooling + the migration procedure (no behavior change)

**Files:** Modify `packages/react/package.json` (devDeps).

- [ ] **Step 1: Add `sass` (compile scss) + `clsx` (class merge) to the package**

In `packages/react/package.json`:
```json
  "dependencies": {
    "@ag-ui/client": "^0.0.55",
    "@atizar/core": "*",
    "clsx": "^2.1.1",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "sass": "^1.80.0"
  }
```
Run: `yarn install --ignore-engines`.

- [ ] **Step 2: Confirm Vite handles scss-modules in dev**

The demo (`apps/inbox`) is built by Vite, which compiles `*.module.scss` natively once `sass` is installed. No config needed for dev. Verify after the first block migration (Task 2) by running `yarn dev` and checking the block renders styled.

- [ ] **Step 3: Commit**

```bash
git add packages/react/package.json yarn.lock
git commit -m "build(react): add sass + clsx for CSS Module migration"
```

### THE PER-BLOCK MIGRATION PROCEDURE (apply verbatim to each block in Tasks 2–N)

For a block `Foo` (`components/Foo.tsx`):

1. **Find its class names:** `grep -oE "className=('|\`|\{)[^>]*" packages/react/src/components/Foo.tsx` and list the literal class strings it uses (e.g. `agent-card`, `card-top`, `status`, `dot`, `is-error`).
2. **Find their rules:** for each class, `grep -n "\.<class>\b" packages/react/src/styles.css` and copy the full rule blocks (including nested/`:hover`/`.s-running` variants and `.dot.awaiting_approval` compound selectors).
3. **Create `components/Foo.module.scss`:** paste the copied rules. Keep `var(--atz-*)` references **unchanged** (custom properties cascade through hashed classes). Convert global compound selectors to nested scss where natural (e.g. `.status .dot { } .status.s-running { }` → `.status { .dot { } &.s-running { } }`) — purely cosmetic, same output.
4. **Rewrite the TSX:** `import s from './Foo.module.scss'`; replace each `className='x'` → `className={s.x}`; compound/conditional → `clsx(s.x, cond && s.y)`; **always merge the incoming prop** if the component accepts one: `className={clsx(s.root, className)}`. For status-keyed classes like `s-${status}` use a typed lookup: `s[\`s-\${status}\`]` (CSS Modules expose kebab/camel keys; verify the emitted key name).
5. **Delete the moved rules from `styles.css`.**
6. **Verify:** `yarn typecheck` + `yarn test` green; `yarn dev` → the block renders pixel-identical (browser).
7. **Commit:** `git commit -m "refactor(react): migrate Foo to CSS Module"`.

> CSS Modules key gotcha: class names with dashes (`.card-top`) are accessed as `s['card-top']` OR `s.cardTop` depending on `localsConvention`. Default Vite = the literal `s['card-top']`. Use bracket access for dashed names unless you set `css.modules.localsConvention: 'camelCaseOnly'` in the Phase-4 vite config (recommended — then use `s.cardTop`). Decide in Task 2 and stay consistent.

### Task 2: Migrate `AgentCard` (first — proves the procedure + the dashed-key convention)

**Files:** Create `components/AgentCard.module.scss`; Modify `components/AgentCard.tsx`; Modify `styles.css`.
Known classes (from `WorkflowBoard`/AgentCard usage): `agent-card`, `is-error`, `card-top`, `card-icon`, `status`, `s-${status}`, `dot ${status}`, `card-headtext`, `agent-name`, `run-foot`, `foot-hint`, `card-foot`.

- [ ] **Step 1:** Apply the per-block procedure steps 1–3 (grep classes, copy rules, create the module).
- [ ] **Step 2:** Decide the dashed-key convention NOW: set `localsConvention: 'camelCaseOnly'` (so `s.cardTop`). Note it for Phase 4's vite config. Rewrite `AgentCard.tsx` (procedure step 4) using `clsx`:
```tsx
import clsx from 'clsx'
import s from './AgentCard.module.scss'
// …
<div className={clsx(s.agentCard, unhealthy && s.isError)} onClick={onOpen}>
  <div className={s.cardTop}>
    <span className={clsx(s.status, s[`s${capitalize(status)}`])}>
      <span className={clsx(s.dot, s[status])} />
```
> `status`/`dot` keyed by a runtime status string: keep those class names as-is in the module and access via `s[status]` (status values like `running`, `awaiting_approval` have no dash → safe). For `s-${status}` rename the scss class to `sRunning` etc. OR keep `s-running` and access `s['s-running']` — pick whichever the emitted keys allow; verify by logging `s` once.
- [ ] **Step 3:** Procedure steps 5–6 (delete from styles.css; typecheck + test + browser parity).
- [ ] **Step 4:** Commit `refactor(react): migrate AgentCard to CSS Module`.

### Tasks 3–N: Migrate the remaining blocks (apply the procedure to each)

Apply the **per-block migration procedure** above to each, one commit per block, browser-verifying parity each time. Order (leaf → composite, so a parent's remaining global rules shrink predictably):

- [ ] **Task 3:** `primitives/*` — `Button`, `IconButton`, `StopButton`, `Modal`, `Drawer`, `Segmented`, `Switch`, `ConfirmDialog`, `CompHeader` (each gets its own `*.module.scss`; these are leaf, low-risk).
- [ ] **Task 4:** `components/Icon`, `components/ConnectionChip`, `components/Connections`.
- [ ] **Task 5:** `components/AgentGrid` (its own grid/legend rules — note `.agent-grid`/`.legend`/`.main` shells: decide whether `.main`/`.agent-grid` belong to the block module or to `base.css`; since `BoardApp` (userland) wraps them, keep the structural shells in `base.css` and put only card-grid-internal styling in the module).
- [ ] **Task 6:** `components/PipelineColumn`.
- [ ] **Task 7:** `components/AgentModal`, `components/ThreadModal`, `components/InstancePickerModal`.
- [ ] **Task 8:** `components/AppHeader`, `components/WorkflowTabs`, `components/WorkflowSwitcher`, `components/ActivityPanel`.

For each task: run the procedure per block listed, commit per block. Do NOT batch multiple blocks into one commit (keeps browser-verify and revert granular).

### Task 9: Reduce `styles.css` → `base.css`

**Files:** Rename `styles.css` → `base.css`; Modify the `exports` + the demo import.

- [ ] **Step 1:** After all blocks migrated, `styles.css` should contain only: `@import './tokens.css';`, the reset (`*`, `body`, element defaults), the legacy var aliases (still needed until/unless every rule uses `--atz-*` directly — keep for safety), and the board layout shells (`.app`, `.workspace-body`, `.main`, `.main-scroll`, `.agent-grid`, `.legend`). Confirm with `grep -c "^\." styles.css` that no block-specific selectors remain.
- [ ] **Step 2:** Rename `styles.css` → `base.css`. Update `package.json` exports key `"./styles.css"` → keep the public name `"./styles.css": "./src/base.css"` (consumers/demo keep importing `@atizar/react/styles.css`; only the internal filename changed) — OR keep the filename `styles.css`. **Recommendation:** keep the public export name `styles.css` stable; rename the internal file only if it adds clarity. If unsure, leave the filename as `styles.css` and just shrink it. (Document the choice in the commit.)
- [ ] **Step 3:** Browser-verify the full board once more (layout shells intact). `yarn test` + `yarn typecheck` green.
- [ ] **Step 4:** Commit `refactor(react): shrink global stylesheet to reset + layout shells`.

---

## Phase 4 — Publish build (Vite library mode)

### Task 10: Vite library config

**Files:** Create `packages/react/vite.config.ts`; Modify `packages/react/package.json` (devDeps).

- [ ] **Step 1:** Add build devDeps to `packages/react/package.json`:
```json
  "devDependencies": {
    "sass": "^1.80.0",
    "vite": "^6.0.0",
    "vite-plugin-dts": "^4.3.0",
    "@vitejs/plugin-react": "^4.3.0"
  }
```
Run: `yarn install --ignore-engines`. (Pin to the versions already used elsewhere in the monorepo — check root `yarn.lock` for the existing `vite`/`@vitejs/plugin-react` versions and match them.)

- [ ] **Step 2:** Create `packages/react/vite.config.ts`:
```ts
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [react(), dts({ include: ['src'], rollupTypes: true })],
  css: { modules: { localsConvention: 'camelCaseOnly' } },
  build: {
    lib: {
      entry: { index: resolve(__dirname, 'src/index.ts') },
      formats: ['es'],
    },
    rollupOptions: {
      // peers + workspace siblings must NOT be bundled
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@atizar/core',
        '@ag-ui/client',
        'zod',
        'clsx',
      ],
    },
    sourcemap: true,
    emptyOutDir: true,
  },
})
```
> `css.modules.localsConvention` MUST match the convention chosen in Phase 3 Task 2 (`camelCaseOnly` → `s.cardTop`). Vite extracts all imported CSS (incl. the migrated `.module.scss` + `tokens.css`/`base.css` if imported by the entry) into `dist/atizar-react.css` (or `dist/style.css` — check the emitted name).

- [ ] **Step 3:** Make the entry import the global CSS so it lands in the built bundle. Confirm `src/index.ts` (or a side-effect import) pulls in `base.css` + `tokens.css` so the published `dist` CSS contains the reset, layout shells, AND token defaults. If `index.ts` shouldn't import CSS (tree-shaking), instead document that consumers import `@atizar/react/styles.css` + the per-component CSS is auto-collected — verify which Vite emits and align the `exports`.

- [ ] **Step 4:** Run the build:
Run: `yarn workspace @atizar/react vite build`
Expected: `packages/react/dist/` contains `index.js`, `index.d.ts` (rolled up), and a CSS file. No bundled React (check `dist/index.js` does not inline react).

- [ ] **Step 5:** Commit `build(react): add Vite library build (esm + dts + css)`.

### Task 11: Conditional exports (dev = src, published = dist)

**Files:** Modify `packages/react/package.json`.

- [ ] **Step 1:** Add a `build` script + conditional `exports` so the in-monorepo demo keeps resolving source (fast HMR) while a published install resolves the compiled `dist`:
```json
{
  "name": "@atizar/react",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "vite build"
  },
  "files": ["dist"],
  "sideEffects": ["*.css"],
  "exports": {
    ".": {
      "development": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./styles.css": "./dist/atizar-react.css",
    "./tokens.css": "./src/tokens.css"
  }
}
```
> Match `./styles.css` to the actual emitted CSS filename from Task 10 Step 4. The `development` condition resolves to `src` for the monorepo (Vite sets the `development` condition in `serve`); the published consumer (no `development` condition) gets `dist`. KEEP `"private": true` for now (npm publish is a separate, later go) — the build readiness is what this delivers. Verify the demo dev server still resolves `src` (HMR works) AND `yarn typecheck` resolves types.

- [ ] **Step 2:** Verify both paths:
Run: `yarn dev` → demo works, HMR on a block edit (dev → src).
Run: `yarn workspace @atizar/react build && yarn typecheck` → build + types green.

- [ ] **Step 3:** Commit `build(react): conditional exports — src in dev, dist when published`.

### Task 12: Reverse the "no build step" docs + final verification

**Files:** Modify `CLAUDE.md`, `docs/ARCHITECTURE.md` (§8 Packaging).

- [ ] **Step 1:** Update the docs. In `docs/ARCHITECTURE.md` §8 and `CLAUDE.md` ("No build step — each package's exports points at ./src/index.ts"), replace with the new reality: publishable packages build via **Vite library mode** to `dist` (ESM + `.d.ts` + compiled CSS); the monorepo still consumes `src` in dev via a conditional `development` export. `@atizar/react` is converted first (it has the CSS); the other packages adopt the same pattern when published. Note this reverses the earlier convention deliberately, for npm publication.
- [ ] **Step 2:** Run `check-foundation` on the packaging-convention change (touches ARCHITECTURE §8 / the packaging principle — NOT an invariant I1-I15). Expected verdict: CLEAR (publication is the stated goal; this enables it without touching any belief/invariant). Record it.
- [ ] **Step 3:** Full green gate: `yarn typecheck && yarn test && yarn lint && yarn workspace @atizar/react build && yarn format:check`. Browser-verify the demo once more (styled identically, board fully functional).
- [ ] **Step 4:** Commit `docs: reverse no-build-step for publishable packages (Vite lib mode)`.

---

## Self-Review (done while writing)

- **Spec coverage:** Plan B covers spec §4 (co-located `.module.scss` — Tasks 1–9) and §6 (Vite lib build + `exports → dist` + reverse no-build-step — Tasks 10–12). Spec §5 token bundling is verified in Task 10 Step 3 (tokens land in the built CSS). Together with Plan A, the whole spec is covered.
- **Placeholder scan:** the CSS migration is intentionally a *procedure over existing rules* (the real CSS is in `styles.css`, not inventable) — each block task names its classes + the exact grep/move/verify steps, which is the correct form for migrating existing styles, not a placeholder. The two genuine decisions (dashed-key convention; `styles.css` rename vs keep) are resolved inline (camelCaseOnly; keep the public export name stable).
- **Type/contract consistency:** `localsConvention: 'camelCaseOnly'` is fixed once (Phase 3 Task 2) and reused in the Phase 4 vite config (Task 10) — they must match (called out). `external` list matches the package's deps/peers. The public `./styles.css` export name is kept stable across the rename.

## Definition of done (Plan B)

All blocks on co-located `*.module.scss` (global `styles.css` reduced to reset + layout shells + token import); `clsx` className-merge preserved on every block that accepts `className`; `yarn workspace @atizar/react build` emits a publishable `dist/` (ESM + rolled-up `.d.ts` + compiled CSS containing block styles + token defaults) with React externalized; conditional `exports` keep monorepo dev on `src` (HMR) and a published install on `dist`; CLAUDE.md / ARCHITECTURE §8 updated (no-build-step reversed); `check-foundation` CLEAR; full green gate + browser parity. npm `publish` itself remains a later, explicit step (package stays `private` until then).
