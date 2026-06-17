# Terminal Color Recolor (rejected/stopped neutral, only error red) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make **only `error`** render red (danger / needs-attention). The user-terminal outcomes — `done`, `stopped`, `rejected` — render **neutral/grey**, because they are intentional endings, nothing broke. Current bug: `rejected` renders with the red/error tint on the pipeline node + instance picker (`.mini.rejected` / `.pl-single.rejected` / `.pl-inst.rejected` in `packages/react/src/styles.css`), so "Rejected" reads as a crash. The **distinct labels** ("Stopped" / "Rejected") are KEPT — only the COLOR changes. This is the spec's group **5. Color recolor** → E2E cases **T2/T3 color** and **C6** (`docs/superpowers/specs/2026-06-17-agent-view-lifecycle-presentation.md` §3 "Color semantics" + §7 "Color"; `docs/superpowers/specs/2026-06-17-agent-view-e2e-cases.md` C6/T2/T3).

**Architecture:** The list surfaces (pipeline mini-cards, the not-yet-built single node, the instance picker) tint via the pure helper `pillTint(status, outcome)` in `packages/react/src/statusDisplay.ts`, which for a distinct-terminal outcome reads `OUTCOME_TINT[outcome]` from `packages/react/src/lifecycleDisplay.ts`. `OUTCOME_TINT` already routes `superseded`/`reset` to the **`'stopped'`** tint class (the shared neutral-terminal grey: `#f6f6f7` bg / `var(--muted)` ink in `styles.css`), while `stopped` itself is also `'stopped'` and only `rejected` is the rogue red (`'rejected'` → `.…rejected` red blocks in `styles.css`). The fix is therefore one helper-map edit — **point `OUTCOME_TINT['rejected']` at the neutral `'stopped'` tint class** (which `stopped`/`superseded`/`reset` already share) — then delete the now-dead red `.mini.rejected` / `.pl-single.rejected` / `.pl-inst.rejected` CSS blocks. `error` stays `'err'` (red) untouched. The AgentCard TYPE surface is **already correct** (its `dotClass`/`pillClass` key off the raw `outcome` string and `AgentCard.module.scss` already renders `.rejected`/`.s-rejected` muted grey `#b6bbc0`/`#8a8f94`) — verified, no edit there. The visual is **unit-testable** at the helper (`OUTCOME_TINT['rejected']` is the neutral token, not the danger one; `pillTint('done','rejected') === pillTint('done','stopped') !== pillTint('done','error')`) and **browser-verified** for T2/T3.

**Tech Stack:** TypeScript, Vitest, React + Testing Library, CSS-Modules (`camelCaseOnly`) + a hand-authored global `styles.css`; `@atizar/react` Vite library build.

This is an **independent presentation change**. It is listed after spec group 1 (the shared `isLive`/`isBusy`, plan **P0**, `packages/react/src/liveness.ts`) but does **NOT require it** — nothing here reads liveness; the helper + CSS edits stand alone. If P0 has not landed, this plan still applies cleanly.

## Global Constraints

> **READ FIRST — two standing rules for whoever implements this (the reason this whole plan set exists). Hold them on EVERY task:**
> 1. **Always think about the framework/app boundary.** Before placing any non-trivial code, ask: generic *mechanism* every workflow needs (→ `@atizar/*`) or *one workflow's policy* (→ `apps/inbox/...`)? A framework symbol carries ZERO workflow knowledge — no `reply/reader/spam/email/ticket` literals. Unsure → default to the app; lift only when a 2nd consumer proves it generic. Don't let the two get confused.
> 2. **Never multiply sources of truth.** One derivation per concept (liveness, status, priority, counts). Reuse the existing predicate/classifier; a new question is asked OF the one status, never a forked new set.

- **Framework/app boundary (I5):** everything here is **framework-generic** `@atizar/react` presentation — `OUTCOME_TINT` keys on the generic `Outcome` union from `@atizar/core` and emits generic tint class names (`run`/`await`/`err`/`stopped`); **no** `reply/reader/spam/email/sorter` literal appears. No app (`apps/inbox`) edit.
- **TDD:** no production/CSS-mapping change without a failing test first. Watch each test fail, then pass. (The list-surface tint IS the helper output, so it is unit-testable; the rendered pixel is browser-verified — see Task 3.)
- **Keep the distinct LABELS.** `OUTCOME_LABEL` ("Stopped" / "Rejected") is **NOT touched**. Only `OUTCOME_TINT` (color) changes. The existing `lifecycleDisplay.test.ts:5-10` (labels) and `statusDisplay.test.ts:9-11` (rejected reads "Rejected") MUST stay green.
- **CSS-Module `localsConvention: 'camelCaseOnly'` camelizes BOTH `-` and `_`.** This plan does **not** add or rename any status-keyed CSS-Module class (the `.rejected`/`.stopped` classes in `styles.css` are **plain global** classes composed by string in `pillTint`, not module locals; the AgentCard `s[camelize(outcome)]` path is untouched). No new `camelize()` call is introduced. Noted because we touch tint classes — but the change is "stop emitting `.rejected`, emit the existing `.stopped`", not a new keyed class.
- **CSS change → rebuild the react lib.** Any `packages/react` change (the helper + the global `styles.css`) requires `yarn workspace @atizar/react build` so `dist/react.css` reflects the deleted red blocks (the demo consumes `./src` in dev but the published/dist CSS must match).
- **Green gate before "done":** `yarn typecheck && yarn test && yarn lint && yarn format:check` from repo root, plus `yarn workspace @atizar/react build`.
- **`check-foundation` NOT needed** — presentation only; no actions/providers/`@atizar/core`/boundary/foundation-doc edit (the change lives entirely in `@atizar/react` display helpers + CSS).

---

### Task 1: React — recolor `rejected` to the neutral terminal tint in `OUTCOME_TINT`

**Files:**
- Modify: `packages/react/src/lifecycleDisplay.ts:21-29` (`OUTCOME_TINT` map + its comment)
- Test: `packages/react/src/lifecycleDisplay.test.ts` (extend), `packages/react/src/statusDisplay.test.ts` (extend)

**Interfaces:**
- Consumes: the `Outcome` union from `@atizar/core` (unchanged).
- Produces: `OUTCOME_TINT['rejected'] === 'stopped'` (the shared neutral-terminal tint class), `OUTCOME_TINT['error'] === 'err'` (red, unchanged). Downstream, `pillTint('done','rejected')` now equals `pillTint('done','stopped')` and differs from `pillTint('done','error')`. No label change.

- [ ] **Step 1: Write the failing color tests**

In `packages/react/src/lifecycleDisplay.test.ts`, **add** (do NOT remove the existing `'tints stopped/rejected distinctly from done'` test at lines 12-15 — it stays green because `'stopped' !== 'run'`):

```ts
describe('OUTCOME_TINT color semantics (only error is danger)', () => {
  it('rejected uses the neutral terminal tint, not the danger tint', () => {
    // user-terminal: a declined draft is an intentional ending, not a crash
    expect(OUTCOME_TINT.rejected).toBe('stopped') // the shared neutral-terminal class
    expect(OUTCOME_TINT.rejected).not.toBe(OUTCOME_TINT.error)
  })
  it('stopped is the neutral terminal tint too', () => {
    expect(OUTCOME_TINT.stopped).toBe('stopped')
    expect(OUTCOME_TINT.stopped).not.toBe(OUTCOME_TINT.error)
  })
  it('error stays the danger (err) tint', () => {
    expect(OUTCOME_TINT.error).toBe('err')
  })
  it('superseded/reset stay neutral (regression)', () => {
    expect(OUTCOME_TINT.superseded).toBe('stopped')
    expect(OUTCOME_TINT.reset).toBe('stopped')
  })
})
```

In `packages/react/src/statusDisplay.test.ts`, **add** a tint assertion alongside the existing rejected-label test (the label test at lines 9-11 stays — labels are unchanged):

```ts
describe('pillTint color semantics (rejected/stopped neutral, error red)', () => {
  it('a rejected item tints neutral — same as stopped, NOT the error tint', () => {
    expect(pillTint('done', 'rejected')).toBe(pillTint('done', 'stopped'))
    expect(pillTint('done', 'rejected')).not.toBe(pillTint('error', 'error'))
  })
  it('the distinct LABEL is kept even though the color is neutral', () => {
    expect(pillLabel('done', 'rejected')).toBe('Rejected') // unchanged
  })
})
```

(`pillTint`/`pillLabel` are already imported at the top of `statusDisplay.test.ts:2`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @atizar/react test src/lifecycleDisplay.test.ts src/statusDisplay.test.ts`
(or from repo root: `yarn test packages/react/src/lifecycleDisplay.test.ts packages/react/src/statusDisplay.test.ts`)
Expected: FAIL — `OUTCOME_TINT.rejected` is currently `'rejected'`, so `expect(...).toBe('stopped')` and `pillTint('done','rejected') === pillTint('done','stopped')` both fail.

- [ ] **Step 3: Recolor `rejected` in `OUTCOME_TINT`**

In `packages/react/src/lifecycleDisplay.ts`, change the `rejected` entry (line 24) from `'rejected'` to `'stopped'`, and update the comment (lines 19-20) to state the color canon. Result:

```ts
// Tint class suffix per outcome (consumed where a terminal card needs a distinct colour).
// COLOR CANON (spec 2026-06-17 §3/§7): only `error` is the danger/red tint (`err`). Every
// user-terminal outcome — done/stopped/rejected/superseded/reset — is NEUTRAL: `done` is the
// neutral "run" tint, the rest share the muted-grey `stopped` tint. (rejected keeps its distinct
// LABEL via OUTCOME_LABEL; only its COLOR is neutralised — a declined draft is not a crash.)
export const OUTCOME_TINT: Record<Outcome, string> = {
  running: 'run',
  done: 'run',
  stopped: 'stopped',
  rejected: 'stopped',
  error: 'err',
  superseded: 'stopped',
  reset: 'stopped',
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn test packages/react/src/lifecycleDisplay.test.ts packages/react/src/statusDisplay.test.ts`
Expected: PASS — including the pre-existing label/distinctness tests (rejected still labelled "Rejected"; `'stopped' !== 'run'` so "distinct from done" holds).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/lifecycleDisplay.ts packages/react/src/lifecycleDisplay.test.ts packages/react/src/statusDisplay.test.ts
git commit -m "fix(react): rejected tints neutral (only error is red); keep the Rejected label"
```

---

### Task 2: React — delete the now-dead red `.rejected` CSS blocks in `styles.css`

**Files:**
- Modify: `packages/react/src/styles.css` — the three red `rejected` blocks: `.mini.rejected` + `.mini.rejected .m-state` (lines 1290-1297), `.pl-single.rejected` + `.pl-single.rejected .m-state` (lines 2334-2340), `.pl-inst.rejected` + `.pl-inst.rejected .m-state` (lines 2401-2407).

**Interfaces:**
- Consumes: after Task 1, `pillTint(...)` never emits the `rejected` class on these surfaces — it emits `stopped`. So the `.…rejected` rules are unreachable.
- Produces: `rejected` list items now resolve to the existing neutral `.mini.stopped` / `.pl-single.stopped` / `.pl-inst.stopped` rules (grey `#f6f6f7` bg / `var(--muted)` ink). No red anywhere for rejected.

- [ ] **Step 1: Confirm the classes are dead (grep, not a test — CSS is browser-verified)**

Run: `grep -rn "OUTCOME_TINT\|'rejected'\|\"rejected\"" packages/react/src --include="*.ts" --include="*.tsx" | grep -v ".test."`
Expected: the only remaining producer of the literal `'rejected'` class string is gone (Task 1 changed it to `'stopped'`); `OUTCOME_LABEL.rejected` (the word "Rejected") and the `Outcome` union member remain — those are fine. There must be **no** code path that still passes `'rejected'` into a `className`. (The AgentCard dot keys off the raw `outcome` string via `s[camelize(outcome)]` against its OWN module SCSS, which is already grey — do NOT touch `AgentCard.module.scss`.)

- [ ] **Step 2: Delete the three red `.rejected` blocks**

In `packages/react/src/styles.css`, remove:

```css
/* terminal Rejected — amber/red warning so a rejected draft never reads as a clean Done */
.mini.rejected {
  background: rgba(214, 69, 58, 0.07);
  border-color: rgba(214, 69, 58, 0.32);
}
.mini.rejected .m-state {
  color: #c0392b;
}
```

```css
.pl-single.rejected {
  background: rgba(214, 69, 58, 0.07);
  border-color: rgba(214, 69, 58, 0.32);
}
.pl-single.rejected .m-state {
  color: var(--red-ink);
}
```

```css
.pl-inst.rejected {
  background: rgba(214, 69, 58, 0.07);
  border-color: rgba(214, 69, 58, 0.32);
}
.pl-inst.rejected .m-state {
  color: var(--red-ink);
}
```

Leave the neutral `.mini.stopped` (1283-1289), `.pl-single.stopped` (2327-2333), `.pl-inst.stopped` (2394-2400) blocks intact — those are now what `rejected` resolves to. Leave the `.…err` red blocks intact — `error` keeps red. (Double-check the `.mini.stopped` comment at line 1282 reads "frozen-and-kept run"; optionally broaden it to "neutral terminal — stopped/rejected" since `rejected` now also lands here. Optional, cosmetic.)

- [ ] **Step 3: Build the react lib so dist CSS drops the red rules**

Run: `yarn workspace @atizar/react build`
Expected: clean build. (No status-keyed CSS-Module class changed, so the `camelize`/`localsConvention` gotcha does not apply here — the `.rejected`/`.stopped` classes are plain global classes in `styles.css`, composed by string, not module locals.)

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/styles.css
git commit -m "fix(react): delete dead red .rejected tint blocks (rejected now reuses neutral .stopped)"
```

---

### Task 3: Green gate + browser-verify (T2/T3 color)

**Files:** none (verification only).

- [ ] **Step 1: Full green gate from repo root**

Run: `yarn typecheck && yarn test && yarn lint && yarn format:check`
Expected: all PASS. Then `yarn workspace @atizar/react build` — clean. Fix any fallout before proceeding.

- [ ] **Step 2: Browser-verify the rejected/stopped color (T2/T3 color, C6)**

Invoke the `browser-verify` skill (read it first: dev-server hygiene + Playwright-recovery). Start `yarn dev`; with a deterministic cassette (`DEV_RECORD_REPLAY=1`) drive a reply instance to **awaiting approval** then **Reject** it. Confirm:
  - **T3 color:** the rejected instance's pipeline node (`.pl-single` / `.pl-inst` / `.mini`) and, if it appears, the instance-picker row render in the **neutral muted-grey** tint (`#f6f6f7` bg / muted ink) — **NOT** red. The label still reads **"Rejected"**.
  - **T2 color:** a **Stopped** instance (drive a run, Stop it) is likewise neutral grey, label "Stopped" (regression — it was already neutral; confirm it did not change).
  - **error stays red:** an errored instance keeps the red `.err` tint (do not regress the one danger color).
  - **C6 rollup:** an agent TYPE card whose only/worst live child is rejected/stopped shows no red rollup; a card with an error child shows red. (Per spec C6 the rollup is over **live** children; a receded terminal does not raise it — that recede behavior is plan group 1/P0, out of scope here. Assert only that rejected/stopped contribute **no red**.)

  Keep dev mode OFF (`localStorage['aiw.dev']` unset) for the consumer-surface color assertion. Take a screenshot of the rejected node as evidence.

- [ ] **Step 3: Final commit (only if browser-verify produced fixes)**

```bash
git add -p
git commit -m "test: verify rejected/stopped tint neutral, error stays red (T2/T3/C6)"
```

---

## Self-Review

- **Spec coverage (group 5 — color recolor):** only `error` is red (`OUTCOME_TINT.error = 'err'`, the `.err` red blocks untouched); `done`/`stopped`/`rejected` are neutral (`done = 'run'` neutral, `stopped`/`rejected = 'stopped'` muted-grey) — matches §3 "Color semantics" + §7 "Color: red = `error` only". Distinct LABELS kept (`OUTCOME_LABEL` untouched; existing rejected-label tests stay green) — §7 "Fix is presentation only … neutral color (not red)". Acceptance cases **T2/T3 color** (rejected/stopped recede neutral, not red) and **C6** (card rollup = worst LIVE child; rejected/stopped contribute no red) are the browser-verify targets in Task 3.
- **Verified against the real code (no placeholders):** the actual rogue red lives ONLY in `styles.css` `.mini.rejected` (1290-1297), `.pl-single.rejected` (2334-2340), `.pl-inst.rejected` (2401-2407); `stopped` was already neutral (`#f6f6f7`/`var(--muted)`); `superseded`/`reset` already map to `'stopped'`, so `rejected → 'stopped'` is the idiomatic existing neutral lane. The **AgentCard type surface is already correct** (`AgentCard.module.scss` `.stopped, .rejected` dot = `#b6bbc0`; `.s-stopped, .s-rejected` = `#8a8f94`, keyed off the raw `outcome` string via `s[camelize(outcome)]`) — explicitly NOT edited, and Task 2 Step 1 grep guards that no other `className` path emits `'rejected'`.
- **Unit-testable + browser-verified split, as the prompt asks:** the color decision IS the helper output → asserted in `lifecycleDisplay.test.ts` (`OUTCOME_TINT['rejected'] === 'stopped'`, `!== error`) and `statusDisplay.test.ts` (`pillTint('done','rejected') === pillTint('done','stopped') !== error`); the rendered pixel is browser-verified (Task 3, T2/T3).
- **Regression guards stay green:** the pre-existing `'tints stopped/rejected distinctly from done'` (still true: `'stopped' !== 'run'`) and the rejected/stopped LABEL tests are untouched and asserted to stay green in Task 1 Step 4.
- **Dependency note honored:** independent of plan P0 (`liveness.ts` `isLive`/`isBusy`) — nothing here reads liveness; the C6 "worst LIVE child" recede semantics are P0's, explicitly scoped out (Task 3 asserts only "no red from rejected/stopped").
- **Type/symbol consistency:** `OUTCOME_TINT` (Task 1) is the exact map whose dead `.rejected` output is removed from `styles.css` (Task 2); `pillTint`/`pillLabel`/`OUTCOME_LABEL` are read, not changed. `check-foundation` correctly skipped (no foundation/boundary/core/provider/action touch — pure `@atizar/react` presentation).
