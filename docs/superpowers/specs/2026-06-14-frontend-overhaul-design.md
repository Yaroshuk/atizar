# Frontend Overhaul — Conventions, Connections, Card Redesign — Design

**Status:** design (authored 2026-06-14 in a near-full session; locks decisions so a FRESH session
can write plans + execute autonomously). Three independent workstreams under one spec. Each gets its
own implementation plan (`writing-plans`) and is executed via `subagent-driven-development`, then
browser-verified and merged to `master` (no PR — beta).

**Why this shape:** the authoring session held deep, fresh context over the whole `@atizar/react`
+ `apps/inbox` frontend (just finished the block decomposition, CSS-module migration, Vite lib
build, and an SSE/lifecycle bug hunt). This spec captures the design decisions while that context is
fresh; a clean-context agent then turns each workstream into a plan and executes it with isolated
subagents (controller context stays lean — subagents hold the files, the controller holds reports).

## Read order for the executing agent

`HANDOFF.md` (the "NEXT" pointer) → this spec → `docs/CONVENTIONS.md` (house style) →
`CLAUDE.md` "Don't-rediscover gotchas" (esp. the SSE / `useBoard` / `camelCaseOnly` notes added at
the end of the prior session) → the per-workstream plan you write.

## Execution rules (apply to all three workstreams)

- One workstream = one plan file under `docs/superpowers/plans/` = one branch off `master`.
- Execute via `subagent-driven-development`: fresh implementer subagent per task, then spec-compliance
  + code-quality review per task. Keep the controller lean.
- **Browser-verify every workstream** with the `browser-verify` skill (this codebase's bug class is
  "only the browser catches it" — CSS-module class mismatches, SSE lifecycle, render wiring). Use
  `DEV_RECORD_REPLAY=1` + the lead-inbox / email-inbox / github-triage cassettes.
- Green gate each workstream: `yarn typecheck && yarn test && yarn lint && yarn format:check` (format
  only your files) `&& yarn workspace @atizar/react build`.
- Merge each finished workstream to `master` (fast-forward / direct, no PR), update `HANDOFF.md`,
  delete the merged branch.
- Run `check-foundation` if a workstream touches the framework/userland boundary or packaging
  (WS1 adds a convention; WS2 touches the workflow descriptor contract). Expected: CLEAR.

---

## WS1 — Frontend conventions + structure

**Goal:** codify house structure rules and bring the codebase to them. These rules frame WS2/WS3.

**Rules to add to `docs/CONVENTIONS.md`** (new "Component file & folder structure" section):

1. **One component per file.** A file exports exactly one React component (plus its own `Props`
   type). No second component (not even a small private `Inner`/wrapper) in the same file — extract
   it to its own file. (Pure non-component helpers/hooks may live beside it per rule 2.)
2. **Folder per component.** A component lives in its own folder named for it:
   `ComponentName/ComponentName.tsx` + `ComponentName.module.scss` (its styles) + any
   component-local helpers/hooks/sub-components/tests in that same folder
   (`ComponentName.test.tsx`, `useComponentNameThing.ts`, etc.). A barrel `index.ts` is optional;
   prefer importing the file directly. Truly shared helpers/hooks stay in the package's top-level
   `hooks/` / models — folder-locality is for things used ONLY by that component.
3. **CSS Modules everywhere, including `apps/`.** Every component (package AND userland) owns its
   styles in a co-located `*.module.scss`. No component-specific rules in a global stylesheet. The
   only global CSS is the reset + cross-cutting layout shells + the `--atz-*` token layer
   (`tokens.css`). Class names come from the module (`import s from './X.module.scss'`), merged with
   an incoming `className` via `clsx`. (`localsConvention: 'camelCaseOnly'` — see the CLAUDE.md
   gotcha: it camelizes `-` AND `_`.)

**Refactor to satisfy the rules (scope):**

- **Split `apps/inbox/client/src/BoardApp.tsx`** — it holds both `BoardApp` and the private `Inner`.
  Extract the composition into its own component file under the new folder layout (e.g.
  `BoardApp/BoardApp.tsx` thin wrapper + `BoardApp/BoardInner.tsx`, or fold the wrapper away). One
  component per file.
- **Folderize package components** that aren't already (move `components/AgentCard.tsx` +
  `AgentCard.module.scss` → `components/AgentCard/AgentCard.tsx` + `…module.scss` + its test;
  same for the rest). Mechanical `git mv` + import-path fixes; behavior-identical. (This is large —
  the plan should sequence it block-by-block and keep typecheck green between moves.)
- The **userland card `.module.scss` migration is OWNED BY WS3** (those cards are being rewritten
  there anyway — don't migrate their CSS twice). WS1 establishes the rule + does the package-side
  structure + the BoardApp split; WS3 applies the rule to the cards it redesigns.

**Foundation:** adding a convention + structural moves only. No invariant touched. `check-foundation`
expected CLEAR. Keep `@atizar/core` React-free; the framework/userland boundary is unchanged.

**Risk / verify:** folder moves break import paths + the Vite lib `entry`/`dts` globs + test globs.
Typecheck + build + full test after each batch; browser-verify the board once at the end (styling
intact, hashed classes still resolve).

---

## WS2 — Connections: auto-derive + compact layout

### 2a. Auto-derive `connectionList` from loaded workflows

**Today:** `apps/inbox/server/connections.ts` hardcodes
`connectionList = [{ integration:'gmail', connection:'default', provider:'google' }]`, decoupled
from workflows. Deleting a workflow leaves a stale chip; adding one needs a manual edit.

**Design:** a workflow declares the integrations it needs; `connectionList` is the union across the
loaded workflow descriptors.

- Add an optional field to the workflow descriptor contract (in `@atizar/core`'s `defineWorkflow`,
  or the descriptor type the app aggregates): `connections?: ConnectionDescriptor[]` — i.e.
  `{ integration, connection, provider }[]`. (Keep `connection` defaulting to `'default'` and
  `provider` required so the OAuth bounce knows the endpoint.)
- `apps/inbox/server/connections.ts` builds `connectionList` by unioning `descriptor.connections`
  across `workflowDescriptors`, de-duped by `(integration, connection)`. `scopesFor` stays derived
  from each integration's own `auth.scopes` (unchanged).
- lead-inbox + email-inbox descriptors declare the gmail connection; github-triage declares none
  (it's read-only via `gh`, no OAuth connection) — so removing a workflow now correctly removes its
  chip, and adding one surfaces its connection automatically.
- **Foundation:** this adds a field to the workflow contract (config-as-data, I7) — run
  `check-foundation`. It's additive + declarative; expected CLEAR. Keep the contract type in
  `@atizar/core`, the concrete OAuth/provider wiring in the server (names in core, impl outside).

**Verify:** `/api/connections` returns the gmail row when lead-inbox/email-inbox are loaded; returns
no gmail row if those are removed from the aggregator; github-triage alone → empty connections. Unit
test the union/dedup; browser-verify the chip presence reflects loaded workflows.

### 2b. Compact connections layout in the header

**Today:** each connection is a chip rendered inline in `AppHeader`'s right zone — N connections
grow the row and eat horizontal space.

**Design:** collapse into ONE compact control in the header:

- A single **Connections** button/indicator: an icon (e.g. `plug`/`link`) + a summary state — a
  status dot (all-connected = accent; any-disconnected = amber/danger) and, when >1, a small count.
- Click opens a **popover/menu** anchored under it listing one row per connection:
  integration name + per-row status dot + a Connect / Disconnect action. (Reuse the existing
  `ConnectionChip` look inside the popover rows, or a slimmer row variant.)
- Zero/one connection: the control still works (single row in the popover). The header width is now
  constant regardless of connection count.
- Build it from the existing `useConnections` hook (unchanged data layer) — this is a `@atizar/react`
  chrome change: a new `Connections` popover component (or refit the existing `Connections` /
  `ConnectionChip`), following WS1 structure (own folder + `.module.scss`). `AppHeader` renders the
  one control instead of the chip row.

**Verify (browser):** header shows one compact control; popover lists gmail with correct
connected/disconnected state; Disconnect removes the credential and the dot flips; the header doesn't
widen as connections are added (simulate by temporarily declaring a 2nd connection).

---

## WS3 — Card design overhaul (use `frontend-design`)

**Goal:** the in-thread generative-UI cards look bad — fix them to a clean, consistent,
production-grade look while preserving the Smedja design language and the `--atz-*` tokens.

**Scope (userland cards, `apps/inbox/client/src/components/*`):** worst first —
`EmailBatchCard` (per-row message actions: trash/read/star/keep) and `ApprovalDialog`
(the reply approve/edit surface); then `TriageCard` (github routing — buttons placed badly); then a
consistency sweep of `LeadCard`, `VerdictCard`, `ReplyDraftCard`, `SortSummaryCard`,
`TicketResultCard`. The render-spec wiring (`workflows/*/client.tsx`) is unchanged — only the card
components + their styles.

**Design principles (lock these; the implementer iterates pixels via `frontend-design` + browser):**

- **Keep the design system:** `--atz-*` tokens only (no new raw colors/spacing); Smedja look
  (rounded surfaces, soft shadows, the existing type scale).
- **One card frame.** Introduce/extract a shared **CardShell** (header/kicker/title/badge zone,
  body, actions zone) so every card has the same anatomy and spacing — likely a small primitive in
  `@atizar/react` (`primitives/CardShell`) that userland cards compose (the beta plan already named
  CardShell as a package primitive). Cards become `CardShell` + fields + an actions row.
- **Action hierarchy + alignment.** Primary action is one clear button; secondary actions are ghost;
  actions sit in a single aligned actions row (right- or full-width), never crammed or
  randomly placed. Fix TriageCard's button placement and ApprovalDialog's Save/Reject layout.
- **Per-row message actions (EmailBatchCard):** trash / mark-read / star / keep as consistent
  icon-buttons (IconButton primitive) with tooltips/aria-labels, aligned in a trailing action
  cluster per row; clear selected/applied state; comfortable row spacing and hit targets.
- **Structure (applies WS1):** each card → its own folder + `*.module.scss`; MOVE its slice of the
  package's global `styles.css` (the `approval-*`, `lead-*`, `triage-*`, `batch-*`, `pill*`,
  `verdict-*`, etc. rules) into the card's module; delete those rules from the package stylesheet.
  After WS3, the package `styles.css` no longer carries userland-card CSS.

**Process:** load `frontend-design`; for each card — screenshot the current state (browser,
`?dev=1`, drive to the card via the cassettes), redesign, browser-verify the new look, capture an
after screenshot. Because the design is subjective and the user is away, make defensible decisions in
the design language and collect before/after screenshots in the final report for async review;
don't block.

**Verify (browser, per card):** the card renders styled (hashed module classes resolve), actions are
clear and aligned, and the full flow still works (e.g. ApprovalDialog edit→approve still saves the
edited Gmail draft; EmailBatchCard actions still post; TriageCard routes still deliver). No regression
to the gate/HITL behavior — only presentation.

---

## Scope / YAGNI (explicitly NOT in this work)

- No new card features or new workflows; presentation + structure only (WS3).
- No dark theme, no theming marketplace (tokens already permit dark later).
- No change to the SSE/data hooks, the pipeline, providers, or `@atizar/core` runtime contracts
  beyond the additive `connections?` descriptor field (WS2a).
- No repo-wide refactor beyond the named structural moves (WS1) and the cards (WS3).

## Definition of done (all three)

Conventions written in `docs/CONVENTIONS.md` and the codebase conforms (one component per file;
folder-per-component; CSS Modules incl. apps; package `styles.css` free of userland-card rules);
`connectionList` auto-derived from loaded workflows (stale/extra chips impossible); header shows one
compact connections control with a popover; all in-thread cards redesigned to a clean consistent look
with before/after screenshots; every workstream green-gated, browser-verified, foundation-checked
where relevant, and merged to `master`.
