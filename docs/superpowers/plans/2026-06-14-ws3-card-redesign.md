# WS3 — Card Design Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Load `frontend-design` for the quality bar — but stay WITHIN the existing Smedja design system and `--atz-*` tokens (this is a refinement, not a new aesthetic).

**Goal:** Redesign the 8 in-thread generative-UI cards to a clean, consistent, production-grade look
— one shared card frame, aligned action hierarchy, per-row icon-actions for the email batch — while
preserving the Smedja language and `--atz-*` tokens. Each card moves to a co-located `*.module.scss`
(WS1 structure) and its slice of the package global `styles.css` is removed.

**Architecture:** Extract a `CardShell` primitive into `@atizar/react` (the shared card frame:
icon-badge + kicker/title header, body, aligned actions zone; a `tone` prop covers the white
"default" and amber "attention/approval" looks — unifying today's two ad-hoc frames `.lead-card` and
`.approval`). Every userland card (in `apps/inbox/client/src/components/`) becomes `CardShell` +
fields + an actions row built from the existing `Button`/`IconButton` primitives, with its own
`*.module.scss`. After the cards are migrated, the card-specific class families
(`approval-*`, `lead-card`/`lead-*`, `triage-*`) are deleted from `packages/react/src/styles.css`;
`batch-*` is defined fresh in the EmailBatchCard module. SHARED primitives (`.btn*`, `.pill*`,
`.status*`, `.dot*`) STAY global — package chrome (AgentCard, PipelineColumn, ConnectionChip,
statusDisplay) uses them.

**Tech Stack:** React + TypeScript, `@atizar/react` Vite lib build, SCSS modules
(`localsConvention: 'camelCaseOnly'` — camelizes `-` AND `_`; reference classes as `s.camelName`),
Vitest, `--atz-*` design tokens (`packages/react/src/tokens.css`).

**Locked design principles (the implementer iterates pixels via frontend-design + the browser):**
- `--atz-*` tokens ONLY (no raw hex/px colors). styles.css maps legacy aliases (`--muted` →
  `--atz-color-text-muted`, `--teal` → `--atz-color-accent`, `--amber-bg` → `--atz-amber-bg`, etc.);
  resolve each legacy alias to its `--atz-*` source and use that directly.
- **One frame, one anatomy:** every card = `CardShell` (header: icon badge + kicker + title +
  optional trailing badge; body; actions zone). Consistent padding, radius, shadow, type scale.
- **Action hierarchy:** exactly one PRIMARY action per card (filled `Button variant="primary"` or
  `"teal"`); secondary = `variant="ghost"`. Actions live in ONE aligned row (the CardShell actions
  zone) — never crammed or randomly placed.
- **Per-row icon-actions (EmailBatchCard):** replace the `<select>` dropdown with a trailing cluster
  of `IconButton`s (trash / mark-read / star / keep) per row, each with an `aria-label` + `title`,
  a clear selected/active state, comfortable row spacing + hit targets.

**Workflow → card map (for browser verification — which thread each card appears in):**
lead-inbox: `renderLead`→LeadCard, `renderVerdict`→VerdictCard, `saveDraft`(HITL)→ApprovalDialog.
github-triage: `render_triage`→TriageCard, `render_ticket_result`→TicketResultCard,
`render_reply_draft`→ReplyDraftCard. email-inbox: `renderSort`→SortSummaryCard,
`applyActions`(HITL)→EmailBatchCard.

**Card props (DO NOT change — render-spec wiring in `workflows/*/client.tsx` is fixed):**
- `ApprovalDialog({ data, onApprove(editedBody), onReject })` — editable draft textarea is the
  load-bearing "edited text → Gmail" path; keep the textarea + its value flowing to `onApprove`.
- `EmailBatchCard({ data, onApprove(editedForm), onReject })` — `editedForm` is the per-row chosen
  actions; keep that shape.
- `TriageCard({ tickets, onRoute(target, ticket), onTreatAsLead?(t) })`.
- `LeadCard({ lead })`, `VerdictCard({ data, onDraftReply })`, `ReplyDraftCard({ data:{title,draft} })`,
  `SortSummaryCard({ summary, counts? })`, `TicketResultCard({ data:{title,kind,analysis} })`.

**styles.css line ranges (from the code map — verify before editing):** `.approval*` 1038–1096 +
`.approval-edit` 2514–2527; `.lead-card`/`.lead-*` 792–839 + `.lead-reason` 2507–2511; `.triage-*`
2532–2580. SHARED (KEEP): `.btn*` 577–638 + 2755–2759 + 1006–1011 + 2116–2125; `.pill*` 1012–1035;
`.status*`/`.dot*` 512–574. **Safety rule before deleting any rule:** grep
`packages/react/src` (excluding `*.css`) for the class — delete from styles.css ONLY if no package
`.ts`/`.tsx` references it.

---

## Task 1: Extract the `CardShell` primitive into `@atizar/react`

**Files:**
- Create: `packages/react/src/primitives/CardShell/CardShell.tsx`
- Create: `packages/react/src/primitives/CardShell/CardShell.module.scss`
- Create: `packages/react/src/primitives/CardShell/CardShell.test.tsx`
- Modify: `packages/react/src/primitives/index.ts` (export), `packages/react/src/index.ts` (re-export)

- [ ] **Step 1: Write the failing test**

`CardShell.test.tsx` (render-level, happy-dom):

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { CardShell } from './CardShell.js'

describe('CardShell', () => {
  test('renders kicker, title, body and actions', () => {
    render(
      <CardShell kicker="Approval needed" title="Reply to Acme" actions={<button>Save</button>}>
        <p>body content</p>
      </CardShell>
    )
    expect(screen.getByText('Approval needed')).toBeInTheDocument()
    expect(screen.getByText('Reply to Acme')).toBeInTheDocument()
    expect(screen.getByText('body content')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  test('applies the attention tone class', () => {
    const { container } = render(<CardShell tone="attention">x</CardShell>)
    // the root element carries a class that encodes the tone (camelCaseOnly module class)
    expect(container.firstChild).toHaveClass(...[].concat(
      Array.from((container.firstChild as HTMLElement).classList).filter((c) => /attention/i.test(c))
    ))
    expect((container.firstChild as HTMLElement).className).toMatch(/attention/i)
  })
})
```

(If `toBeInTheDocument`/`toHaveClass` matchers aren't globally set up, use the patterns the existing
package tests use — read `packages/react/src/components/Connections/Connections.test.tsx` for the
established testing-library setup and mirror it. The second test's intent: the `tone="attention"`
root className contains the camelized `attention` module class.)

- [ ] **Step 2: Run — verify it fails**

Run: `yarn test packages/react/src/primitives/CardShell/CardShell.test.tsx`
Expected: FAIL (module doesn't exist).

- [ ] **Step 3: Implement `CardShell.tsx`**

```tsx
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Icon, type IconName } from '../../components/Icon/Icon.js'
import s from './CardShell.module.scss'

type CardShellTone = 'default' | 'attention'

type CardShellProps = {
  tone?: CardShellTone
  icon?: IconName
  kicker?: ReactNode
  title?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}

// The shared card frame every in-thread card composes: an icon-badge + kicker/title header, a body
// slot, and an aligned actions zone. `tone="attention"` is the amber approval look; default is the
// neutral surface card. Keeps all 8 cards on ONE anatomy + spacing.
export const CardShell = ({
  tone = 'default',
  icon,
  kicker,
  title,
  badge,
  actions,
  children,
  className,
}: CardShellProps) => (
  <div className={clsx(s.shell, tone === 'attention' && s.attention, className)}>
    {(icon || kicker || title || badge) && (
      <div className={s.head}>
        {icon && (
          <span className={s.iconBadge}>
            <Icon name={icon} size={16} />
          </span>
        )}
        <div className={s.heading}>
          {kicker && <span className={s.kicker}>{kicker}</span>}
          {title && <span className={s.title}>{title}</span>}
        </div>
        {badge && <span className={s.badge}>{badge}</span>}
      </div>
    )}
    {children && <div className={s.body}>{children}</div>}
    {actions && <div className={s.actions}>{actions}</div>}
  </div>
)
```

- [ ] **Step 4: Implement `CardShell.module.scss`**

Author the frame in Smedja language with `--atz-*` tokens ONLY. Required classes (referenced
camelCase from the component): `.shell` (surface bg, 1px border, radius `--atz-radius-md` or the
existing card radius, soft shadow `--atz-shadow-*`, padding, `display:flex; flex-direction:column;
gap`), `.attention` (amber tone: `background: var(--atz-amber-bg)`, amber border), `.head`
(flex row, gap, align-items center/start), `.iconBadge` (≈30×30 rounded icon container — default
tone neutral `--atz-grey-*`, attention tone amber; nested `.attention .iconBadge` override), `.heading`
(flex column, min-width 0), `.kicker` (≈10.5px UPPERCASE, letter-spacing, muted color; attention =
`--atz-amber-ink`), `.title` (≈16px, font-weight 650, letter-spacing -0.01em, color
`--atz-color-text`), `.badge` (margin-left auto; trailing slot), `.body` (`display:flex;
flex-direction:column; gap`; default text color), `.actions` (flex row, gap, `justify-content:
flex-end` by default — the aligned actions zone; wrap allowed). Match the existing card padding /
radius / shadow values (read `.lead-card` 792–802 and `.approval` 1038–1045 in styles.css and use
the SAME `--atz-*` the legacy aliases there resolve to, so the visual weight is continuous).

- [ ] **Step 5: Export**

In `packages/react/src/primitives/index.ts` add `export { CardShell } from './CardShell/CardShell.js'`.
In `packages/react/src/index.ts` add `export { CardShell } from './primitives/CardShell/CardShell.js'`
(near the other primitive exports).

- [ ] **Step 6: Run the test → PASS; typecheck + build**

Run: `yarn test packages/react/src/primitives/CardShell/CardShell.test.tsx && yarn typecheck && yarn workspace @atizar/react build`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/primitives/CardShell packages/react/src/primitives/index.ts packages/react/src/index.ts
git commit -m "feat(react): add CardShell primitive (shared card frame)"
```

---

## Task 2: Redesign ApprovalDialog + ReplyDraftCard (the approval/attention family)

These two share the amber `.approval` frame. Rebuild both on `CardShell tone="attention"`, each with
its own co-located module. **These are userland cards → folder-per-component (WS1):** move each to
`apps/inbox/client/src/components/<Name>/<Name>.tsx` + `<Name>.module.scss`; update the importers in
`apps/inbox/workflows/lead-inbox/client.tsx` (ApprovalDialog) and
`apps/inbox/workflows/github-triage/client.tsx` (ReplyDraftCard). Move the `EmailBatchCard.test.tsx`
sibling logic only if it imports these (it doesn't).

**Files:**
- Move/Create: `apps/inbox/client/src/components/ApprovalDialog/ApprovalDialog.tsx` +
  `ApprovalDialog.module.scss`
- Move/Create: `apps/inbox/client/src/components/ReplyDraftCard/ReplyDraftCard.tsx` +
  `ReplyDraftCard.module.scss`
- Modify: `apps/inbox/workflows/lead-inbox/client.tsx`,
  `apps/inbox/workflows/github-triage/client.tsx` (import paths)

- [ ] **Step 1: Rebuild ApprovalDialog on CardShell**

`CardShell tone="attention" icon="pen"` (or the existing approval icon), `kicker="Approval needed"`,
`title` = the reply subject if available (else omit). Body = the editable `<textarea>` (class
`s.edit` in the module — width 100%, token border/bg/padding, comfortable min-height, the Smedja
focus ring). Actions = `<Button variant="teal">Save draft</Button>` (PRIMARY, the approve →
`onApprove(textareaValue)`) + `<Button variant="ghost" onClick={onReject}>Reject</Button>`. Keep the
textarea state (`useState(data.body ?? data.draft ?? '')`) so the EDITED value flows to `onApprove` —
this is load-bearing (edited text must reach Gmail). Use `Button`/`IconButton` from `@atizar/react`.

- [ ] **Step 2: Rebuild ReplyDraftCard on CardShell**

`CardShell tone="attention" icon="pen"`, `kicker="Suggested reply · draft, not posted"`, `title` =
`data.title`. Body = a read-only preview (`s.preview` — bordered box, `white-space: pre-wrap`,
token bg/border/padding, muted text). No actions.

- [ ] **Step 3: Author the two `*.module.scss`**

`ApprovalDialog.module.scss`: `.edit` (the textarea). `ReplyDraftCard.module.scss`: `.preview`. Use
`--atz-*` only (resolve the old `.approval-edit` 2514–2527 + `.approval-preview` 1079–1088 values).
The frame (amber bg, header, actions) now comes from CardShell — these modules only hold the
card-unique body bits.

- [ ] **Step 4: Repoint importers + delete old flat files**

`git rm apps/inbox/client/src/components/ApprovalDialog.tsx` and `.../ReplyDraftCard.tsx`. Update the
import specifiers in `lead-inbox/client.tsx` and `github-triage/client.tsx` to the new folder paths.

- [ ] **Step 5: Typecheck + test + build**

Run: `yarn typecheck && yarn test && yarn workspace @atizar/react build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/inbox/client/src/components/ApprovalDialog apps/inbox/client/src/components/ReplyDraftCard apps/inbox/workflows/lead-inbox/client.tsx apps/inbox/workflows/github-triage/client.tsx
git commit -m "feat(cards): redesign ApprovalDialog + ReplyDraftCard on CardShell"
```

---

## Task 3: Redesign EmailBatchCard (the worst — per-row icon actions)

Replace the per-row `<select>` dropdown with a trailing cluster of `IconButton`s. Folder-per-component.

**Files:**
- Move/Create: `apps/inbox/client/src/components/EmailBatchCard/EmailBatchCard.tsx` +
  `EmailBatchCard.module.scss`
- Move: `apps/inbox/client/src/EmailBatchCard.test.tsx` →
  `apps/inbox/client/src/components/EmailBatchCard/EmailBatchCard.test.tsx` (update its import path)
- Modify: `apps/inbox/workflows/email-inbox/client.tsx` (import path)

- [ ] **Step 1: Read the existing test + component**

Read `apps/inbox/client/src/EmailBatchCard.test.tsx` and `components/EmailBatchCard.tsx` to learn the
`EmailBatchData` shape (the per-row actions, the `onApprove(editedForm)` contract). The redesign MUST
preserve that contract — the test asserts the chosen actions flow to `onApprove`. Keep the test green
(update it to drive IconButtons instead of the `<select>` if it selected via the dropdown — change
the interaction, not the asserted output shape).

- [ ] **Step 2: Rebuild on CardShell**

`CardShell tone="attention" icon="inbox"`, `kicker="Review N email(s)"`. Body = `s.rows` (a vertical
list). Each row (`s.row`): `s.rowMeta` (from + subject, truncated) on the left + a trailing
`s.rowActions` cluster of 4 `IconButton`s — trash / mark-read / star / keep — each with `aria-label`
+ `title`; the SELECTED action gets `active` (IconButton supports `active`) + a token accent. Track
per-row selection in state (an action per row id), defaulting to the row's current action. Actions
zone = `<Button variant="teal">Apply X action(s)</Button>` (count of non-"keep" actions) + `<Button
variant="ghost">Reject</Button>`. `onApprove(editedForm)` gets the per-row chosen actions in the
SAME shape as today.

Pick icons from `IconName` (trash → if no `trash` glyph exists, ADD one to Icon.tsx like WS2 added
`link`; mark-read → `check` or `mail`; star → add a `star` glyph or reuse `sparkle`; keep → `close`
is wrong — use a neutral "keep/skip" like `clock` or add `archive`). Prefer adding 1–2 small glyphs
(`trash`, `star`) to `Icon.tsx` over reusing semantically-wrong ones — clarity matters here.

- [ ] **Step 3: Author `EmailBatchCard.module.scss`**

Define `.rows`, `.row` (flex row, gap, padding, border between rows via `--atz-color-border`,
comfortable height), `.rowMeta` (flex column, min-width 0, truncation — `.rowFrom` muted small,
`.rowSubject` text, `text-overflow: ellipsis`), `.rowActions` (trailing flex cluster, gap, margin-left
auto). `--atz-*` only. The `batch-*` rules never existed in styles.css — nothing to delete there.

- [ ] **Step 4: Move the test + repoint importer**

`git mv` the test into the folder, fix its import (`'../EmailBatchCard'` →
`'./EmailBatchCard'`). Repoint `email-inbox/client.tsx`.

- [ ] **Step 5: Run the test → PASS; full gate**

Run: `yarn test apps/inbox/client/src/components/EmailBatchCard/EmailBatchCard.test.tsx && yarn typecheck && yarn workspace @atizar/react build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/inbox/client/src/components/EmailBatchCard apps/inbox/workflows/email-inbox/client.tsx packages/react/src/components/Icon/Icon.tsx
git commit -m "feat(cards): redesign EmailBatchCard with per-row icon actions on CardShell"
```

---

## Task 4: Redesign TriageCard (fix the button placement)

**Files:**
- Move/Create: `apps/inbox/client/src/components/TriageCard/TriageCard.tsx` + `TriageCard.module.scss`
- Modify: `apps/inbox/workflows/github-triage/client.tsx` (import path)

- [ ] **Step 1: Rebuild on CardShell**

`CardShell icon="git"`, `kicker` = `Your tickets · N`. Body = the grouped ticket list (`s.group` with
a `s.groupLabel` per status). Each ticket row (`s.ticket`): `s.ticketTitle` (number + title +
optional `<span className="pill amber">needs reply</span>` — keep the global `.pill` class but ADD
the `.pill.amber` rule to styles.css since it's referenced and missing) on top, then ONE aligned
action row (`s.ticketActions`): the route action as a single PRIMARY `Button variant="primary"`
(`Send to Feature/Bug-fix` / `Draft reply`), a `Button variant="ghost"` "Open in browser" (a link
styled as ghost, or keep the `s.link`), and (if `onTreatAsLead`) a `Button variant="ghost"` "Treat as
lead". The fix: actions are ONE aligned row per ticket (not a heavy full-width dark button stacked
under each), consistent gap, primary-vs-ghost hierarchy.

- [ ] **Step 2: Author `TriageCard.module.scss`**

`.group`, `.groupLabel` (uppercase muted, like old `.triage-status`), `.ticket` (column, gap,
padding, border-top divider), `.ticketTitle` (flex wrap, gap, align center), `.ticketActions` (flex
row, gap, align center — the aligned action row), `.link` (ghost-styled link if not using Button).
`--atz-*` only; resolve the old `.triage-*` 2532–2580 values.

- [ ] **Step 3: Add the missing `.pill.amber` rule to styles.css**

In `packages/react/src/styles.css`, beside `.pill.grey` (~1029–1035), add `.pill.amber { background:
var(--atz-amber-bg); color: var(--atz-amber-ink); }` and `.pill.amber .pill-dot { background:
var(--atz-amber-border); }` (match the `.grey` variant's structure; use the amber tokens). `.pill`
stays global (chrome uses it).

- [ ] **Step 4: Repoint importer + delete old flat file**

`git rm` the old `TriageCard.tsx`; repoint `github-triage/client.tsx`.

- [ ] **Step 5: Typecheck + test + build**

Run: `yarn typecheck && yarn test && yarn workspace @atizar/react build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/inbox/client/src/components/TriageCard apps/inbox/workflows/github-triage/client.tsx packages/react/src/styles.css
git commit -m "feat(cards): redesign TriageCard with aligned action rows on CardShell"
```

---

## Task 5: Redesign the lead-family cards (LeadCard, VerdictCard, SortSummaryCard, TicketResultCard)

All four use the white `.lead-card` frame → rebuild on `CardShell tone="default"`. Folder-per-component
each. The `renderLead`/`renderVerdict` tests (`apps/inbox/client/src/renderLead.test.tsx`,
`renderVerdict.test.tsx`) exercise LeadCard/VerdictCard through the render specs — keep them green
(update import paths if those tests import the card directly; they import via the render spec, so
likely unaffected — verify).

**Files (per card `Name` in {LeadCard, VerdictCard, SortSummaryCard, TicketResultCard}):**
- Move/Create: `apps/inbox/client/src/components/Name/Name.tsx` + `Name.module.scss`
- Modify: the importing `workflows/*/client.tsx`

- [ ] **Step 1: LeadCard** — `CardShell icon="envelope"`, `kicker`/`title`: from (muted) as kicker,
  subject as title; body = the reason text (`s.reason`). No actions. Module holds `.reason` (and any
  `.from`/`.subject` specifics not covered by CardShell's kicker/title).

- [ ] **Step 2: VerdictCard** — `CardShell icon="envelope"`, kicker = from, title = subject; body =
  tags row (`<span className="pill">{category}</span>` + `<span className="pill amber">{priority}</span>`
  using the now-defined global pills) + reason (`s.reason`). Actions = conditional `<Button
  variant="primary" onClick={onDraftReply}>Draft reply</Button>` when a thread/handoff is available
  (preserve the existing condition).

- [ ] **Step 3: SortSummaryCard** — `CardShell icon="inbox"`, kicker/title = "Inbox sorted"; body =
  summary (`s.reason`) + optional counts as a `.pill` row.

- [ ] **Step 4: TicketResultCard** — `CardShell icon={data.kind === 'bug' ? 'bug' : 'wrench'}`,
  kicker/title = "Bug analysis"/"Feature plan" + the ticket title; body = analysis (`s.reason` with
  `white-space: pre-wrap`).

- [ ] **Step 5: Author the four modules** — mostly a shared-shape `.reason` (13px, muted, line-height
  1.45 — resolve `.lead-reason` 2507–2511) + any card-unique bits. `--atz-*` only.

- [ ] **Step 6: Repoint importers + delete old flat files**

`git rm` the four old flat `*.tsx`; repoint each `workflows/*/client.tsx` import. Verify
`renderLead.test.tsx`/`renderVerdict.test.tsx` still resolve the cards (fix their import paths if they
import the card files directly).

- [ ] **Step 7: Typecheck + test + build**

Run: `yarn typecheck && yarn test && yarn workspace @atizar/react build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/inbox/client/src/components apps/inbox/workflows
git commit -m "feat(cards): redesign lead-family cards (Lead/Verdict/SortSummary/TicketResult) on CardShell"
```

---

## Task 6: Remove the migrated card-specific CSS from the package stylesheet

Now that NO card uses `.approval*`, `.lead-card`/`.lead-*`, or `.triage-*`, delete those rules from
`packages/react/src/styles.css`. **Safety guard:** for each class family, FIRST run
`grep -rln "<class>" packages/react/src apps/inbox/client/src apps/inbox/workflows --include='*.tsx' --include='*.ts'`
— delete the rule ONLY if no `.ts`/`.tsx` references it. KEEP `.btn*`, `.pill*`, `.status*`, `.dot*`
(chrome + cards use them).

**Files:**
- Modify: `packages/react/src/styles.css`

- [ ] **Step 1: Confirm zero references to the card-specific families**

Run:
```bash
grep -rn -e "approval-" -e "lead-card" -e "lead-top" -e "lead-env" -e "lead-from" -e "lead-subject" -e "lead-tags" -e "lead-reason" -e "triage-" apps/inbox packages/react/src --include='*.tsx' --include='*.ts'
```
Expected: NO matches in `.tsx`/`.ts` (all moved to modules). If a match remains, that card wasn't
fully migrated — fix it before deleting CSS.

- [ ] **Step 2: Delete the migrated rules**

Remove from `styles.css`: `.approval` + `.approval-*` (1038–1096, 2514–2527), `.lead-card` +
`.lead-*` (792–839, 2507–2511), `.triage-*` (2532–2580). Leave `.pill*`, `.btn*`, `.status*`,
`.dot*`, and the `.pill.amber` rule added in Task 4. Re-check line numbers before cutting (earlier
deletions shift them — delete by searching the selector, not by absolute line).

- [ ] **Step 3: Verify the package stylesheet is free of userland-card CSS**

Run: `grep -nE "\.approval|\.lead-card|\.lead-(top|env|from|subject|tags|reason)|\.triage-" packages/react/src/styles.css`
Expected: NO matches.

- [ ] **Step 4: Full gate + build**

Run: `yarn typecheck && yarn test && yarn lint && yarn workspace @atizar/react build`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/styles.css
git commit -m "refactor(react): remove migrated userland-card CSS from package stylesheet"
```

---

## Task 7: Full green gate + format

- [ ] **Step 1:** Run `yarn typecheck && yarn test && yarn lint && yarn workspace @atizar/react build` → all PASS.
- [ ] **Step 2:** `git diff --name-only master..HEAD -- '*.ts' '*.tsx' '*.scss' | xargs yarn prettier --check` → all clean (else `yarn prettier --write` + commit `chore: format`).

---

## Browser verification (after Task 7, before merge) — use `browser-verify`, `DEV_RECORD_REPLAY=1`

Drive each card to its thread (cassettes: lead-inbox qualifier+reply, email-inbox sorter+workers,
github-triage triage) at `?dev=1`. For EACH card: it renders STYLED (hashed module classes resolve —
the camelCaseOnly bug class), the CardShell frame + aligned actions look right, capture an AFTER
screenshot. Then the THREE flows that must still work (presentation change only — no behavior
regression):
1. **ApprovalDialog edit → approve** (lead-inbox reply gate): edit the draft body to insert a marker,
   approve → fetch the Gmail draft by id → the EDITED body is present (the load-bearing path). Reject
   also works.
2. **EmailBatchCard apply** (email-inbox): choose per-row actions via the new IconButtons, Apply →
   the chosen actions post (the gate resolves with the edited form). Reject works.
3. **TriageCard route** (github-triage): a route/Treat-as-lead action still delivers (a child work
   item appears).
No console errors; status/pills colored; text not split. Collect before/after screenshots for the
async review (befores captured for VerdictCard/LeadCard/TriageCard; describe the rest from the prior
design).

---

## Self-review checklist (run before merge)

- **Spec coverage:** CardShell primitive → Task 1; worst-first ApprovalDialog/EmailBatchCard → Tasks
  2–3; TriageCard → Task 4; sweep of the rest → Task 5; CSS migrated out of package styles.css →
  Task 6. ✓
- **Contracts unchanged:** every card's Props + the render-spec wiring in `workflows/*/client.tsx`
  are identical (only import paths + internals change). ✓
- **camelCaseOnly:** all new module classes referenced as `s.camelName`; the build proves CSS-module
  collection. ✓
- **Shared CSS preserved:** `.btn*`/`.pill*`/`.status*`/`.dot*` stay global (chrome uses them);
  `.pill.amber` ADDED (was missing). ✓
- **WS1 structure:** every redesigned card is now folder-per-component with a co-located
  `.module.scss`. ✓
- **Foundation:** WS3 adds a presentational primitive (CardShell) to `@atizar/react` and refines
  userland cards — the framework/userland boundary is unchanged (machinery in package, cards in
  userland). No invariant touched; `check-foundation` not required by the spec for WS3.
