# WS3 — Markdown Rendering + Prompt Tightening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Render a SAFE markdown subset (bold, italic, lists, inline code, links, code blocks, paragraphs; NO raw HTML) in the assistant text bubble and in card free-text reason fields via one shared `<Markdown>` primitive, then tighten agent prompts so the model stops restating Category/Priority/Reason as markdown prose (those render as card chips).

**Architecture:** A new `@atizar/react` primitive `<Markdown>` wraps `react-markdown` + `remark-gfm`, constrained to a safe element allow-list with `skipHtml` (no `rehype-raw`, no `dangerouslySetInnerHTML`), and customizes `<a>` to add `rel="noopener noreferrer" target="_blank"`. The assistant bubble in `AgentModal` and the model-authored free-text fields on the userland cards (`VerdictCard`, `LeadCard`, `SortSummaryCard`, `TicketResultCard`, `ReplyDraftCard`) consume this one renderer. Agent prompts in `apps/inbox/agents/*.prompts.ts` are tightened so the bubble text is a short plain sentence, not a restatement of the structured fields the card already shows.

**Tech Stack:** Vite (library mode) + React 19 + TypeScript + CSS Modules (SCSS, `camelCaseOnly`), `react-markdown@^10`, `remark-gfm@^4`, vitest + @testing-library/react.

---

## File Structure

**Create**
- `packages/react/src/primitives/Markdown/Markdown.tsx` — the constrained `<Markdown>` primitive (react-markdown + remark-gfm, safe allow-list, `skipHtml`, hardened `<a>`).
- `packages/react/src/primitives/Markdown/Markdown.module.scss` — scoped typography for rendered markdown (paragraph spacing, lists, inline/block code), token-driven.
- `packages/react/src/primitives/Markdown/Markdown.test.tsx` — unit tests: `**x**` → `<strong>`; raw `<script>`/HTML renders inert (escaped, not executed); a link gets `rel="noopener noreferrer" target="_blank"`.

**Modify**
- `packages/react/package.json` — add `react-markdown` + `remark-gfm` to `dependencies`.
- `packages/react/src/primitives/index.ts` — barrel-export `Markdown`.
- `packages/react/src/index.ts` — re-export `Markdown` from the package root.
- `packages/react/src/components/AgentModal/AgentModal.tsx` — render the assistant bubble content through `<Markdown>` (line ~118).
- `apps/inbox/client/src/components/VerdictCard/VerdictCard.tsx` — wrap `data.reason` in `<Markdown>`.
- `apps/inbox/client/src/components/LeadCard/LeadCard.tsx` — wrap `lead.summary` in `<Markdown>`.
- `apps/inbox/client/src/components/SortSummaryCard/SortSummaryCard.tsx` — wrap `summary` in `<Markdown>`.
- `apps/inbox/client/src/components/TicketResultCard/TicketResultCard.tsx` — wrap `data.analysis` in `<Markdown>`.
- `apps/inbox/client/src/components/ReplyDraftCard/ReplyDraftCard.tsx` — wrap `data.draft` in `<Markdown>`.
- `apps/inbox/agents/qualifier.prompts.ts` — tighten bubble guidance (do not restate category/priority/reason as prose).
- `apps/inbox/agents/triage.prompts.ts` — tighten bubble guidance.
- `apps/inbox/agents/ticket.prompts.ts` — tighten bubble guidance.
- `apps/inbox/agents/reply.prompts.ts` — tighten bubble guidance.

**Test (modify/extend)**
- `apps/inbox/agents/qualifier.prompts.test.ts` — assert the new "do not restate" instruction is present.
- `apps/inbox/agents/triage.prompts.test.ts` — assert the new "do not restate" instruction is present.

---

### Task 1: Add `react-markdown` + `remark-gfm` dependencies to `@atizar/react`

**Files:**
- `packages/react/package.json` (lines 23–28, the `dependencies` block)

`react-markdown` is NOT yet installed; `remark-gfm@4.0.1` is present transitively but MUST become a direct dependency of `@atizar/react` (it is bundled into the published `dist` — these are regular deps, not externalized peers, so the Vite lib build rolls them in; see `packages/react/vite.config.ts` `rollupOptions.external`, which lists only react/react-dom/jsx-runtime/@atizar/core/@ag-ui/client/zod/clsx — NOT these two, by design).

- [ ] **Step 1: Add the two deps to `packages/react/package.json`.**
  Edit the `dependencies` object (currently `@ag-ui/client`, `@atizar/core`, `clsx`, `zod`) to add the two new entries, keeping alphabetical order and the existing 2-space indentation:

  ```json
  "dependencies": {
    "@ag-ui/client": "^0.0.55",
    "@atizar/core": "*",
    "clsx": "^2.1.1",
    "react-markdown": "^10.1.0",
    "remark-gfm": "^4.0.1",
    "zod": "^3.25.76"
  },
  ```

- [ ] **Step 2: Install from the repo root.**
  Run (yarn-classic workspace install; the `--ignore-engines` is the documented mitigation on Node 20.14):
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && yarn install --ignore-engines
  ```
  Expected: install completes; `react-markdown` now resolves. Verify:
  ```bash
  ls /Users/yaroshuk/Development/AiWorkflow/node_modules/react-markdown/package.json && cat /Users/yaroshuk/Development/AiWorkflow/node_modules/react-markdown/package.json | grep '"version"'
  ```
  Expected: prints the file path and a `"version": "10.x.x"` line.

- [ ] **Step 3: Commit the dependency addition.**
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && git add packages/react/package.json yarn.lock && git commit -m "build(react): add react-markdown + remark-gfm deps for WS3

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 2: Create the `<Markdown>` primitive (TDD)

**Files:**
- `packages/react/src/primitives/Markdown/Markdown.test.tsx` (Create)
- `packages/react/src/primitives/Markdown/Markdown.tsx` (Create)
- `packages/react/src/primitives/Markdown/Markdown.module.scss` (Create)

The primitive mirrors the house style of the other primitives (`StopButton.tsx`, `CardShell.tsx`): a named-export arrow-const component, `type {Name}Props` declared inline, `import s from './X.module.scss'`, sibling imports use the `.js` extension. It is SAFE by construction: `react-markdown@10` escapes raw HTML by default; we additionally pass `skipHtml` (raw HTML nodes dropped) and an `allowedElements` allow-list (the safe inline+block subset only), and we do NOT use `rehype-raw` or `dangerouslySetInnerHTML`. The `components` prop hardens every `<a>` with `rel="noopener noreferrer" target="_blank"`.

- [ ] **Step 1: Write the failing test file.**
  Create `packages/react/src/primitives/Markdown/Markdown.test.tsx` with the EXACT content:

  ```tsx
  import '@testing-library/jest-dom/vitest'
  import { describe, expect, it } from 'vitest'
  import { render, screen } from '@testing-library/react'
  import { Markdown } from './Markdown.js'

  describe('Markdown', () => {
    it('renders **bold** as a <strong> element', () => {
      const { container } = render(<Markdown>{'Hello **world**'}</Markdown>)
      const strong = container.querySelector('strong')
      expect(strong).not.toBeNull()
      expect(strong).toHaveTextContent('world')
    })

    it('renders *italic* as an <em> element', () => {
      const { container } = render(<Markdown>{'an *important* note'}</Markdown>)
      const em = container.querySelector('em')
      expect(em).not.toBeNull()
      expect(em).toHaveTextContent('important')
    })

    it('renders a markdown list as <ul><li> items', () => {
      const { container } = render(<Markdown>{'- one\n- two'}</Markdown>)
      const items = container.querySelectorAll('li')
      expect(items).toHaveLength(2)
      expect(items[0]).toHaveTextContent('one')
      expect(items[1]).toHaveTextContent('two')
    })

    it('renders inline code as a <code> element', () => {
      const { container } = render(<Markdown>{'use `npm test`'}</Markdown>)
      const code = container.querySelector('code')
      expect(code).not.toBeNull()
      expect(code).toHaveTextContent('npm test')
    })

    it('hardens links with rel + target', () => {
      const { container } = render(<Markdown>{'[site](https://example.com)'}</Markdown>)
      const link = container.querySelector('a')
      expect(link).not.toBeNull()
      expect(link).toHaveAttribute('href', 'https://example.com')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('renders raw HTML inert — no <script> element is created and no markup is injected', () => {
      const payload = 'before <script>window.__pwned = true</script> after <b>x</b>'
      const { container } = render(<Markdown>{payload}</Markdown>)
      // No live elements from the raw HTML reach the DOM (skipHtml drops them; nothing executes).
      expect(container.querySelector('script')).toBeNull()
      expect(container.querySelector('b')).toBeNull()
      // The surrounding plain text still renders (the content is neutralized, not lost).
      expect(container.textContent).toContain('before')
      expect(container.textContent).toContain('after')
    })

    it('renders nothing extra for empty content', () => {
      const { container } = render(<Markdown>{''}</Markdown>)
      expect(container.querySelector('strong')).toBeNull()
    })
  })
  ```

- [ ] **Step 2: Run the test — expect FAIL (module does not exist yet).**
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && yarn test packages/react/src/primitives/Markdown/Markdown.test.tsx
  ```
  Expected: vitest fails to resolve `./Markdown.js` — `Failed to load url ./Markdown.js` / "Cannot find module". This confirms the test runs and the implementation is missing.

- [ ] **Step 3: Create the `Markdown.module.scss`.**
  Create `packages/react/src/primitives/Markdown/Markdown.module.scss` with the EXACT content (token-driven, mirrors CardShell's `--atz-*` usage; class names are camelCase so `camelCaseOnly` leaves them as-is):

  ```scss
  // Markdown — scoped typography for the constrained <Markdown> primitive. The renderer
  // is SAFE by construction (skipHtml + allowedElements + no rehype-raw); this module only
  // styles the resulting inline + block elements so they read like prose inside a bubble or
  // a card body. Colors/radii resolve through --atz-* design tokens.

  .root {
    // Inherit the surface's font-size/color; just tame block spacing so a single
    // paragraph reads identically to today's plain text.
    color: inherit;
    font-size: inherit;
    line-height: 1.45;

    p {
      margin: 0;
    }

    p + p {
      margin-top: 8px;
    }

    ul,
    ol {
      margin: 6px 0;
      padding-left: 18px;
    }

    li + li {
      margin-top: 2px;
    }

    a {
      color: var(--atz-color-link, #0a66c2);
      text-decoration: underline;
    }

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.92em;
      background: var(--atz-grey-50, #f0f0f2);
      border-radius: var(--atz-radius-sm, 4px);
      padding: 1px 5px;
    }

    pre {
      margin: 8px 0;
      padding: 10px 12px;
      background: var(--atz-grey-50, #f0f0f2);
      border-radius: var(--atz-radius-sm, 6px);
      overflow-x: auto;

      code {
        background: none;
        padding: 0;
      }
    }
  }
  ```

- [ ] **Step 4: Create the `Markdown.tsx` primitive.**
  Create `packages/react/src/primitives/Markdown/Markdown.tsx` with the EXACT content:

  ```tsx
  import clsx from 'clsx'
  import ReactMarkdown from 'react-markdown'
  import remarkGfm from 'remark-gfm'
  import s from './Markdown.module.scss'

  // The ONE constrained markdown renderer every surface shares (assistant bubble +
  // card free-text reason fields). SAFE by construction:
  //   - react-markdown ESCAPES raw HTML by default; `skipHtml` additionally DROPS raw
  //     HTML nodes — and we do NOT enable `rehype-raw` and never touch
  //     dangerouslySetInnerHTML, so an injected <script>/<img onerror> can never render.
  //   - `allowedElements` pins the output to a safe inline + block subset (bold, italic,
  //     lists, inline code, links, code blocks, paragraphs). Anything outside the list is
  //     stripped (its text children survive via `unwrapDisallowed`).
  //   - every <a> is hardened with rel="noopener noreferrer" target="_blank".
  // `remark-gfm` adds GFM niceties (autolinks, task lists) on the SOURCE side; it does not
  // weaken the HTML-safety guarantees above.

  // The safe inline + block element subset. Headings/tables/images/blockquotes are
  // intentionally omitted — a thread bubble and a card body want prose, not document chrome.
  const ALLOWED = [
    'p',
    'strong',
    'em',
    'del',
    'ul',
    'ol',
    'li',
    'code',
    'pre',
    'a',
    'br',
  ]

  type MarkdownProps = {
    // The markdown source string (e.g. an assistant message or a card reason field).
    children: string
    // Extra class on the wrapper (e.g. to inherit a bubble/card text color).
    className?: string
  }

  export const Markdown = ({ children, className }: MarkdownProps) => (
    <div className={clsx(s.root, className)}>
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        allowedElements={ALLOWED}
        unwrapDisallowed
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target='_blank' rel='noopener noreferrer' />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
  ```

- [ ] **Step 5: Run the test — expect PASS.**
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && yarn test packages/react/src/primitives/Markdown/Markdown.test.tsx
  ```
  Expected: all 7 tests in `Markdown.test.tsx` pass.

- [ ] **Step 6: Commit the primitive.**
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && git add packages/react/src/primitives/Markdown && git commit -m "feat(react): add constrained <Markdown> primitive (safe subset, no raw HTML)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 3: Export `Markdown` from the primitives barrel and the package root

**Files:**
- `packages/react/src/primitives/index.ts` (line 13, after the `CardShell` export)
- `packages/react/src/index.ts` (line 47, after the `CardShell` re-export)

- [ ] **Step 1: Add to the primitives barrel.**
  In `packages/react/src/primitives/index.ts`, after the line `export { CardShell } from './CardShell/CardShell.js'` add:
  ```ts
  export { Markdown } from './Markdown/Markdown.js'
  ```

- [ ] **Step 2: Re-export from the package root.**
  In `packages/react/src/index.ts`, after the line `export { CardShell } from './primitives/CardShell/CardShell.js'` (line 47) add:
  ```ts
  export { Markdown } from './primitives/Markdown/Markdown.js'
  ```

- [ ] **Step 3: Typecheck — expect PASS.**
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && yarn typecheck
  ```
  Expected: `tsc --build` completes with no errors (the new export resolves; `@atizar/react` consumers can now import `Markdown`).

- [ ] **Step 4: Build `@atizar/react` — expect PASS.**
  An `@atizar/react` change requires the package build to stay green (CLAUDE.md green-gate rule). Run:
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && yarn workspace @atizar/react build
  ```
  Expected: Vite library build succeeds; `packages/react/dist/index.js`, `packages/react/dist/index.d.ts`, and `packages/react/dist/react.css` are emitted (react-markdown + remark-gfm are bundled in, since they are not in `rollupOptions.external`). No "unresolved import" warnings for `react-markdown`/`remark-gfm`.

- [ ] **Step 5: Commit the exports.**
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && git add packages/react/src/primitives/index.ts packages/react/src/index.ts && git commit -m "feat(react): export <Markdown> from primitives barrel + package root

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 4: Render the assistant bubble through `<Markdown>` in `AgentModal`

**Files:**
- `packages/react/src/components/AgentModal/AgentModal.tsx` (import block lines 1–8; the bubble JSX at line 118)

Only the assistant text bubble at line 118 (`<div className={s.bubble}>{msg.content}</div>`) changes. The `intro` bubble at line 176 is a hardcoded one-liner authored by us (not model output) — leave it as plain text; markdown there buys nothing and keeps the change minimal. The handoff note `<strong>` lines (166, 180) are our own JSX, unchanged.

- [ ] **Step 1: Add the `Markdown` import.**
  In `packages/react/src/components/AgentModal/AgentModal.tsx`, after the existing primitives/components imports add a sibling import. Insert after line 7 (`import { Icon, type IconName } from '../Icon/Icon'`):
  ```ts
  import { Markdown } from '../../primitives/Markdown/Markdown'
  ```
  (Note: within-package source imports in this file use NO `.js` extension — match the existing `'../Icon/Icon'` style on line 7, not the barrel's `.js` form.)

- [ ] **Step 2: Wrap the bubble content in `<Markdown>`.**
  Replace the bubble JSX (line 118):
  ```tsx
          <div className={s.bubble}>{msg.content}</div>
  ```
  with:
  ```tsx
          <div className={s.bubble}>
            <Markdown>{msg.content}</Markdown>
          </div>
  ```
  (`msg.content` is already guarded `typeof msg.content === 'string' && msg.content.length > 0` on line 112, so it is always a non-empty string here.)

- [ ] **Step 3: Typecheck — expect PASS.**
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && yarn typecheck
  ```
  Expected: no errors.

- [ ] **Step 4: Rebuild `@atizar/react` — expect PASS.**
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && yarn workspace @atizar/react build
  ```
  Expected: build succeeds.

- [ ] **Step 5: Commit the AgentModal change.**
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && git add packages/react/src/components/AgentModal/AgentModal.tsx && git commit -m "feat(react): render assistant bubble text through <Markdown>

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 5: Render card free-text fields through `<Markdown>`

**Files:**
- `apps/inbox/client/src/components/VerdictCard/VerdictCard.tsx` (line 1 import; line 40 `<p className={s.reason}>{data.reason}</p>`)
- `apps/inbox/client/src/components/LeadCard/LeadCard.tsx` (line 1 import; line 10 `<p className={s.reason}>{lead.summary}</p>`)
- `apps/inbox/client/src/components/SortSummaryCard/SortSummaryCard.tsx` (line 1 import; line 16 `<p className={s.reason}>{summary}</p>`)
- `apps/inbox/client/src/components/TicketResultCard/TicketResultCard.tsx` (line 1 import; line 12 `<p className={s.reason}>{data.analysis}</p>`)
- `apps/inbox/client/src/components/ReplyDraftCard/ReplyDraftCard.tsx` (line 1 import; line 14 `<div className={s.preview}>{data.draft}</div>`)

These cards live in userland (`apps/inbox`) and already import from `@atizar/react`, so they pull `Markdown` from the package root export added in Task 3. Each model-authored free-text field is the source — the structured chips (category/priority pills, counts) stay literal and are NOT wrapped. The wrapper element stays a `<p>`/`<div>` so existing `s.reason`/`s.preview` styling (color, font-size, line-height) still applies; `<Markdown>` renders its own `<p>` inside (its `.root p { margin: 0 }` keeps spacing flat).

- [ ] **Step 1: VerdictCard — import + wrap `data.reason`.**
  In `apps/inbox/client/src/components/VerdictCard/VerdictCard.tsx`, change line 1 from:
  ```tsx
  import { CardShell, Button } from '@atizar/react'
  ```
  to:
  ```tsx
  import { CardShell, Button, Markdown } from '@atizar/react'
  ```
  and change line 40 from:
  ```tsx
      <p className={s.reason}>{data.reason}</p>
  ```
  to:
  ```tsx
      <div className={s.reason}>
        <Markdown>{data.reason}</Markdown>
      </div>
  ```

- [ ] **Step 2: LeadCard — import + wrap `lead.summary`.**
  In `apps/inbox/client/src/components/LeadCard/LeadCard.tsx`, change line 1 from:
  ```tsx
  import { CardShell } from '@atizar/react'
  ```
  to:
  ```tsx
  import { CardShell, Markdown } from '@atizar/react'
  ```
  and change line 10 from:
  ```tsx
      <p className={s.reason}>{lead.summary}</p>
  ```
  to:
  ```tsx
      <div className={s.reason}>
        <Markdown>{lead.summary}</Markdown>
      </div>
  ```

- [ ] **Step 3: SortSummaryCard — import + wrap `summary`.**
  In `apps/inbox/client/src/components/SortSummaryCard/SortSummaryCard.tsx`, change line 1 from:
  ```tsx
  import { CardShell } from '@atizar/react'
  ```
  to:
  ```tsx
  import { CardShell, Markdown } from '@atizar/react'
  ```
  and change line 16 from:
  ```tsx
      <p className={s.reason}>{summary}</p>
  ```
  to:
  ```tsx
      <div className={s.reason}>
        <Markdown>{summary}</Markdown>
      </div>
  ```

- [ ] **Step 4: TicketResultCard — import + wrap `data.analysis`.**
  In `apps/inbox/client/src/components/TicketResultCard/TicketResultCard.tsx`, change line 1 from:
  ```tsx
  import { CardShell } from '@atizar/react'
  ```
  to:
  ```tsx
  import { CardShell, Markdown } from '@atizar/react'
  ```
  and change line 12 from:
  ```tsx
      <p className={s.reason}>{data.analysis}</p>
  ```
  to:
  ```tsx
      <div className={s.reason}>
        <Markdown>{data.analysis}</Markdown>
      </div>
  ```

- [ ] **Step 5: ReplyDraftCard — import + wrap `data.draft`.**
  In `apps/inbox/client/src/components/ReplyDraftCard/ReplyDraftCard.tsx`, change line 1 from:
  ```tsx
  import { CardShell } from '@atizar/react'
  ```
  to:
  ```tsx
  import { CardShell, Markdown } from '@atizar/react'
  ```
  and change line 14 from:
  ```tsx
      <div className={s.preview}>{data.draft}</div>
  ```
  to:
  ```tsx
      <div className={s.preview}>
        <Markdown>{data.draft}</Markdown>
      </div>
  ```

- [ ] **Step 6: Typecheck — expect PASS.**
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && yarn typecheck
  ```
  Expected: no errors (all five cards resolve `Markdown` from `@atizar/react`).

- [ ] **Step 7: Run the existing card test to confirm no regression.**
  `EmailBatchCard.test.tsx` is the only colocated card test; it is untouched by these edits but verify the card suite still passes:
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && yarn test apps/inbox/client/src/components
  ```
  Expected: existing card tests pass (PASS).

- [ ] **Step 8: Commit the card changes.**
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && git add apps/inbox/client/src/components/VerdictCard/VerdictCard.tsx apps/inbox/client/src/components/LeadCard/LeadCard.tsx apps/inbox/client/src/components/SortSummaryCard/SortSummaryCard.tsx apps/inbox/client/src/components/TicketResultCard/TicketResultCard.tsx apps/inbox/client/src/components/ReplyDraftCard/ReplyDraftCard.tsx && git commit -m "feat(cards): render free-text fields through <Markdown>

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 6: Tighten agent prompts so the bubble does not restate card fields (TDD)

**Files:**
- `apps/inbox/agents/qualifier.prompts.test.ts` (extend; describe block at lines 7–41)
- `apps/inbox/agents/qualifier.prompts.ts` (the `fromInbox` tail lines 16–18; the `fromHandedLead` tail lines 46)
- `apps/inbox/agents/triage.prompts.test.ts` (extend)
- `apps/inbox/agents/triage.prompts.ts` (the closing instruction lines 19–21)
- `apps/inbox/agents/ticket.prompts.ts` (the `resultFirst` tail line 38; the `replyFirst` tail line 56)
- `apps/inbox/agents/reply.prompts.ts` (the `handoffFirst` tail lines 36–38)

The cards already render Category/Priority/Reason (VerdictCard), the routes (TriageCard), the analysis (TicketResultCard), the draft (ReplyDraftCard). The prompts must steer the model's *bubble* text to a single short plain sentence and NOT re-list those structured fields as markdown prose. Each prompt already says "keep any text brief and user-facing" — add an explicit "do not restate the card's fields" clause. The qualifier and triage get a test (they have prompt tests already); ticket/reply prompts are tightened consistently (their tests assert handoff routing, not bubble copy, so no test change is required there).

- [ ] **Step 1: Write failing assertions in `qualifier.prompts.test.ts`.**
  In `apps/inbox/agents/qualifier.prompts.test.ts`, inside the `describe('qualifier prompt strategy', …)` block, add a new test after the existing `it('embeds origin in the renderVerdict instruction', …)` test (after line 19):

  ```ts
    it('tells the model not to restate the card fields in its text', () => {
      const p = prompts.buildFirst(input([]))
      expect(p).toContain('do not restate')
    })
  ```

- [ ] **Step 2: Run it — expect FAIL.**
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && yarn test apps/inbox/agents/qualifier.prompts.test.ts
  ```
  Expected: the new test fails — `expected '…' to contain 'do not restate'`. The other qualifier tests still pass.

- [ ] **Step 3: Tighten the qualifier `fromInbox` prompt.**
  In `apps/inbox/agents/qualifier.prompts.ts`, replace the `fromInbox` closing lines 16–18:
  ```ts
      'threadId, from and subject come from get_latest_email. Do NOT draft a reply and',
      'do NOT save anything. Do not narrate your tool usage or mention tools/schemas —',
      'keep any text brief and user-facing.',
  ```
  with:
  ```ts
      'threadId, from and subject come from get_latest_email. Do NOT draft a reply and',
      'do NOT save anything. Do not narrate your tool usage or mention tools/schemas.',
      'The card already shows category, priority and reason — do not restate them in',
      'your text. Reply with at most ONE short plain sentence; do not use markdown',
      'headings, bold labels, or lists to repeat the structured fields.',
  ```

- [ ] **Step 4: Tighten the qualifier `fromHandedLead` prompt.**
  In the same file, replace the `fromHandedLead` closing line 46:
  ```ts
      'Keep any text brief and user-facing; do not narrate tools.',
  ```
  with:
  ```ts
      'The card already shows category, priority and reason — do not restate them in',
      'your text. Reply with at most ONE short plain sentence; do not narrate tools or',
      'use markdown headings/bold labels/lists to repeat the structured fields.',
  ```

- [ ] **Step 5: Run the qualifier test — expect PASS.**
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && yarn test apps/inbox/agents/qualifier.prompts.test.ts
  ```
  Expected: all qualifier prompt tests pass, including the new "do not restate" assertion (it is present in both the inbox and handed-lead paths).

- [ ] **Step 6: Write a failing assertion in `triage.prompts.test.ts`.**
  Read the current `apps/inbox/agents/triage.prompts.test.ts` first (to match its `describe`/`it` style and the `prompts` instance name), then add a test inside its describe block:
  ```ts
    it('tells the model not to restate the tickets in its text', () => {
      const p = prompts.buildFirst()
      expect(p).toContain('do not restate')
    })
  ```
  (If the test file constructs prompts via a different variable name or calls `buildFirst` with an argument, match the existing pattern in that file — the assertion content stays the same.)

- [ ] **Step 7: Run it — expect FAIL.**
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && yarn test apps/inbox/agents/triage.prompts.test.ts
  ```
  Expected: the new test fails — `expected '…' to contain 'do not restate'`.

- [ ] **Step 8: Tighten the triage prompt.**
  In `apps/inbox/agents/triage.prompts.ts`, replace the closing lines 19–21:
  ```ts
      'After render_triage, STOP: reply with at most ONE short sentence. Do NOT list or',
      'summarize the tickets again (the card already shows them) and do not narrate tools —',
      'repeating them wastes time and can stall the run.',
  ```
  with:
  ```ts
      'After render_triage, STOP: reply with at most ONE short plain sentence. The card',
      'already shows the tickets and routes — do not restate them, and do not use markdown',
      'headings, bold labels or lists to repeat them. Do not narrate tools; repeating the',
      'tickets wastes time and can stall the run.',
  ```

- [ ] **Step 9: Run the triage test — expect PASS.**
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && yarn test apps/inbox/agents/triage.prompts.test.ts
  ```
  Expected: all triage prompt tests pass, including the new assertion.

- [ ] **Step 10: Tighten the ticket prompts (no test change — consistency).**
  In `apps/inbox/agents/ticket.prompts.ts`, in `resultFirst` replace line 38:
  ```ts
      'is your write-up. Do not narrate tool usage — keep text brief and user-facing.',
  ```
  with:
  ```ts
      'is your write-up. The card already shows the analysis — do not restate it in your',
      'text. Reply with at most ONE short plain sentence; do not narrate tool usage.',
  ```
  and in `replyFirst` replace line 56:
  ```ts
      'draft is your suggested reply. Do not narrate tool usage — keep text brief.',
  ```
  with:
  ```ts
      'draft is your suggested reply. The card already shows the draft — do not restate it',
      'in your text. Reply with at most ONE short plain sentence; do not narrate tools.',
  ```

- [ ] **Step 11: Tighten the reply prompt (no test change — consistency).**
  In `apps/inbox/agents/reply.prompts.ts`, in `handoffFirst` replace lines 36–38:
  ```ts
      'human before saving.',
      'Do NOT create the draft yet and do NOT send anything. Do not narrate your',
      'tool usage or mention tools/schemas — keep any text brief and user-facing.',
  ```
  with:
  ```ts
      'human before saving.',
      'Do NOT create the draft yet and do NOT send anything. Do not narrate your tool',
      'usage or mention tools/schemas. The cards already show the lead and the draft — do',
      'not restate them in your text. Reply with at most ONE short plain sentence; do not',
      'use markdown headings, bold labels or lists to repeat the structured fields.',
  ```

- [ ] **Step 12: Run all four prompt test suites — expect PASS.**
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && yarn test apps/inbox/agents
  ```
  Expected: qualifier, triage, ticket, reply (and the agent tests) all pass — the ticket/reply prompt tests assert handoff routing, which is unchanged.

- [ ] **Step 13: Commit the prompt tightening.**
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && git add apps/inbox/agents/qualifier.prompts.ts apps/inbox/agents/qualifier.prompts.test.ts apps/inbox/agents/triage.prompts.ts apps/inbox/agents/triage.prompts.test.ts apps/inbox/agents/ticket.prompts.ts apps/inbox/agents/reply.prompts.ts && git commit -m "feat(agents): tighten prompts so bubble text does not restate card fields

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 7: Full green gate

**Files:** none (verification only).

- [ ] **Step 1: Typecheck.**
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && yarn typecheck
  ```
  Expected: `tsc --build` exits 0, no errors.

- [ ] **Step 2: Full test suite.**
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && yarn test
  ```
  Expected: all suites pass (450+ tests), including the new `Markdown.test.tsx` and the new prompt assertions. (Pipeline tests need the test Postgres up — `postgres://aiworkflow:aiworkflow@localhost:5432/aiworkflow_test`; if Docker is down, start it first per `browser-verify`/dev-servers notes.)

- [ ] **Step 3: Lint.**
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && yarn lint
  ```
  Expected: ESLint GREEN, zero errors. (The `node: _node` rename in the `<a>` component avoids the unused-var rule while dropping react-markdown's non-DOM `node` prop; if ESLint flags `_node`, confirm the config's `argsIgnorePattern`/`varsIgnorePattern` allows a leading underscore — it does in this repo's flat config.)

- [ ] **Step 4: Format check.**
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && yarn format:check
  ```
  Expected: Prettier reports all matched files use the configured style. If it flags any new/edited file, run `yarn format`, re-run `format:check`, and amend the relevant commit.

- [ ] **Step 5: Build `@atizar/react` (required — package changed).**
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && yarn workspace @atizar/react build
  ```
  Expected: Vite lib build succeeds; `dist/index.js` + `dist/index.d.ts` (now exporting `Markdown`) + `dist/react.css` (now carrying the `.root` markdown styles) emitted. No unresolved-import warning for `react-markdown`/`remark-gfm` (both bundled).

- [ ] **Step 6: If any gate step produced a formatting/lint fix, commit it.**
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && git status --short
  ```
  If clean, nothing to do. Otherwise stage only the specific touched paths (never `git add -A`/`.` — the user edits docs in parallel) and commit:
  ```bash
  cd /Users/yaroshuk/Development/AiWorkflow && git add <specific-paths> && git commit -m "chore(ws3): green-gate formatting/lint fixups

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Done when

Acceptance criteria copied from spec §2 WS3:

- [ ] The screenshot case renders bold/list correctly (no literal `**`) — the assistant bubble and the card reason render `**bold**`, `*italic*`, `- list` items, inline `` `code` ``, fenced code blocks, and links as real HTML, not literal markdown source.
- [ ] A raw-HTML/script string in agent text renders inert (no injection) — a `<script>`/HTML payload in the bubble or a card field renders escaped/neutralized with nothing executed (`skipHtml`, no `rehype-raw`, no `dangerouslySetInnerHTML`).
- [ ] Links carry `rel="noopener noreferrer" target="_blank"`.
- [ ] The agent prompts no longer instruct (and the model no longer produces) a markdown restatement of Category/Priority/Reason — the structured fields live in the card chips; the bubble is a short plain sentence.
- [ ] Green gate: `yarn typecheck` && `yarn test` && `yarn lint` && `yarn format:check` all pass, AND `yarn workspace @atizar/react build` succeeds (the `@atizar/react` change requires the package build).
- [ ] Browser-verified (see below).

## Browser-verify

This project's hard rule (CLAUDE.md "Always run browser E2E" + the `browser-verify` skill): markdown rendering and the split/escape behavior are exactly the class of bug **only the browser catches** — unit tests pass over happy-dom but the real surface (the `.bubble` and card bodies through the live thread `EventSource`) can render differently, and contiguous-text-delta / stale-stream artifacts only show in the running app.

- [ ] Invoke the `browser-verify` skill first (dev-server hygiene: free `:4000`/`:5173`, kill stale `tsx watch`, recover the Playwright-MCP profile lock if "Browser is already in use").
- [ ] Start the app from the repo root: `cd /Users/yaroshuk/Development/AiWorkflow && yarn dev` (server :4000 + client :5173; `/api` proxied). Prefer `DEV_RECORD_REPLAY=1` to replay cassettes for fast deterministic runs; if a prompt change must be re-captured, `DEV_RECORD_REPLAY=record` (cassettes are gitignored — never share without the scan-and-warn ritual).
- [ ] Drive a workflow that produces a VerdictCard (the Lead Qualifier / `email-inbox`): START, wait for the run, open the agent thread.
- [ ] Confirm in the browser: the VerdictCard's reason renders any markdown (bold/list/code) as real formatting — NO literal `**`/`-`/backticks; the category/priority pills are unchanged; the assistant bubble is a short plain sentence that does NOT restate the chip fields.
- [ ] Confirm the link hardening: if a link appears in rendered markdown, it opens in a new tab (`target="_blank"`) — inspect the `<a>` in devtools for `rel="noopener noreferrer"`.
- [ ] Confirm inert raw HTML: if feasible, force an agent text/field containing `<script>` or `<img onerror=…>` (a temporary recorded cassette edit or a record run with crafted content) and verify nothing executes and no element is injected — escaped/dropped text only. Revert any temporary cassette edit afterward.
- [ ] Verify `?dev=1` still reveals raw tool-call chips and that the cards-only default consumer thread is unchanged otherwise (no console errors, no reconnect storm — watch the network panel for a single board stream + per-item stream that closes on terminal status).
