# WS2 — Connections: auto-derive + compact layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (2a) Auto-derive the server's `connectionList` from the integrations each loaded workflow
declares, so a stale/extra chip is impossible; (2b) collapse the header's connection chip row into
ONE compact "Connections" control with a popover.

**Architecture:** 2a adds an additive, declarative `connections?` field to the `WorkflowDescriptor`
contract in `@atizar/core` (names in core; concrete OAuth/provider wiring stays in the server), then
`apps/inbox/server/connections.ts` unions that field across `workflowDescriptors` via a pure,
unit-tested `deriveConnectionList()`. 2b is a `@atizar/react` chrome change: the existing
`Connections` component is reshaped into a single button (icon + summary status dot + count) that
toggles a popover listing one `ConnectionChip` per connection. `AppHeader` is unchanged (it already
renders `<Connections/>`).

**Tech Stack:** React + TypeScript, `@atizar/core` (pure, Node-free, React-free contract), Hono
server, Vitest, SCSS modules (`camelCaseOnly`), `@atizar/react` Vite lib build.

**Key facts (from the code map):**
- `WorkflowDescriptor` lives in `packages/core/src/defineWorkflow.ts` — fields `id, label, iconName,
  agents, entryAgentId, inputs, prompt?`. NO `connections` field today. `defineWorkflow()` validates
  structure; an optional passthrough field needs no new validation.
- `apps/inbox/server/connections.ts` (19 lines) hardcodes
  `connectionList = [{ integration:'gmail', connection:'default', provider:'google' }]` and exports
  `scopesFor(integration)` (reads `@atizar/integrations/gmail/auth` scopes). It does NOT import the
  workflow aggregator today — it will need to import `workflowDescriptors` from
  `apps/inbox/workflows/index.ts`.
- `ConnectionDescriptor = { integration, connection, provider }` lives in `@atizar/server`
  (`packages/server/src/connectRoutes.ts`); `connectionList: ConnectionDescriptor[]` is what
  `apps/inbox/server/connections.ts` exports and the connect routes consume.
- Workflow descriptors: `apps/inbox/workflows/{lead-inbox,email-inbox,github-triage}/descriptor.ts`.
  lead-inbox + email-inbox use Gmail; github-triage uses `gh` (no OAuth connection).
- `useConnections()` (`packages/react/src/hooks/useConnections.ts`) → `{ connections:
  ConnectionStatus[], refetch }`; `ConnectionStatus = { integration, connection, provider,
  connected, detail? }`. Unchanged in WS2 (data layer stays).
- `Connections` (`packages/react/src/components/Connections/Connections.tsx`) self-fetches via
  `useConnections`, renders a `.connList` row of `<ConnectionChip>`s; `ConnectionChip` is a pill
  (dot + name + Connect/Disconnect). `AppHeader` renders `<Connections/>` in `s.ahRight` when
  `!demo`.
- `Icon` (`packages/react/src/components/Icon/Icon.tsx`) has NO `link`/`plug` glyph — 2b adds one to
  `IconName` + `PATHS`.

---

## Task 1: Add the `connections?` field to the `WorkflowDescriptor` contract (2a, core)

**Files:**
- Modify: `packages/core/src/defineWorkflow.ts`
- Test: `packages/core/src/defineWorkflow.test.ts` (create if absent; otherwise add a test)

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/defineWorkflow.test.ts` (create the file if it doesn't exist — mirror the
existing test style in `packages/core/src/*.test.ts`; import `defineWorkflow` from
`./defineWorkflow.js`, plus a minimal valid agent/input to satisfy validation — copy the smallest
valid descriptor any existing core test already builds, or construct one with a single input-role
agent). The test asserts the new optional field passes through untouched:

```ts
test('defineWorkflow passes connections through unchanged', () => {
  const wf = defineWorkflow({
    id: 'w',
    label: 'W',
    iconName: 'inbox',
    agents: [{ agent: inputAgent, role: 'input' }],
    entryAgentId: inputAgent.id,
    inputs: [],
    connections: [{ integration: 'gmail', provider: 'google' }],
  })
  expect(wf.connections).toEqual([{ integration: 'gmail', provider: 'google' }])
})

test('defineWorkflow omits connections when not declared', () => {
  const wf = defineWorkflow({
    id: 'w2',
    label: 'W2',
    iconName: 'inbox',
    agents: [{ agent: inputAgent, role: 'input' }],
    entryAgentId: inputAgent.id,
    inputs: [],
  })
  expect(wf.connections).toBeUndefined()
})
```

(`inputAgent` = a minimal `defineAgent(...)` with `role` usable as input — reuse the helper/pattern
from a sibling core test; if none exists, build the smallest agent `defineAgent` accepts.)

- [ ] **Step 2: Run the test — verify it fails**

Run: `yarn test packages/core/src/defineWorkflow.test.ts`
Expected: FAIL — `connections` is not a known property (TS) / `wf.connections` is undefined for the
first test.

- [ ] **Step 3: Add the type + field**

In `packages/core/src/defineWorkflow.ts`, add a `WorkflowConnection` type and the optional field.
Place the type above `WorkflowDescriptor`:

```ts
// A connection (OAuth credential) a workflow requires. `connection` defaults to 'default' at the
// point of use (the server union). `provider` is required so the OAuth bounce knows the endpoint.
// Names live here in core; the concrete OAuth/provider wiring stays in the server layer.
export type WorkflowConnection = {
  integration: string
  connection?: string
  provider: string
}
```

Add to `WorkflowDescriptor` (after `prompt?`):

```ts
  // Integrations (OAuth connections) this workflow needs. The server unions these across all
  // loaded workflows to derive the live connection list — a stale/extra chip becomes impossible.
  connections?: WorkflowConnection[]
```

`defineWorkflow()` already spreads/returns the validated descriptor; if it constructs the return
object field-by-field rather than returning the input, add `connections: def.connections` to the
returned object. Read the function body and match its existing return style. Export
`WorkflowConnection` from the package barrel `packages/core/src/index.ts` (find the existing
`WorkflowDescriptor`/`WorkflowInput` export line and add `WorkflowConnection` beside it).

- [ ] **Step 4: Run the test — verify it passes**

Run: `yarn test packages/core/src/defineWorkflow.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `yarn typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/defineWorkflow.ts packages/core/src/defineWorkflow.test.ts packages/core/src/index.ts
git commit -m "feat(core): add optional connections field to WorkflowDescriptor contract"
```

---

## Task 2: Derive `connectionList` from loaded workflows (2a, server)

**Files:**
- Modify: `apps/inbox/server/connections.ts`
- Create: `apps/inbox/server/connections.test.ts`
- Modify: `apps/inbox/workflows/lead-inbox/descriptor.ts`,
  `apps/inbox/workflows/email-inbox/descriptor.ts` (declare the gmail connection)
- (github-triage descriptor: NO change — it declares no connection)

- [ ] **Step 1: Declare the gmail connection on the two Gmail workflows**

In `apps/inbox/workflows/lead-inbox/descriptor.ts`, add to the `defineWorkflow({...})` object (after
`inputs`):
```ts
  connections: [{ integration: 'gmail', provider: 'google' }],
```
Same addition in `apps/inbox/workflows/email-inbox/descriptor.ts`. Do NOT touch github-triage's
descriptor.

- [ ] **Step 2: Write the failing test for the pure derivation**

Create `apps/inbox/server/connections.test.ts`. It tests a pure exported
`deriveConnectionList(descriptors)` (added in Step 4) — union + default `connection` to `'default'`
+ dedupe by `(integration, connection)`:

```ts
import { describe, expect, test } from 'vitest'
import { deriveConnectionList } from './connections.js'
import type { WorkflowDescriptor } from '@atizar/core'

const wf = (id: string, connections?: WorkflowDescriptor['connections']): WorkflowDescriptor => ({
  id,
  label: id,
  iconName: 'inbox',
  agents: [],
  entryAgentId: 'x',
  inputs: [],
  connections,
})

describe('deriveConnectionList', () => {
  test('unions connections across workflows and defaults connection to "default"', () => {
    const list = deriveConnectionList([
      wf('a', [{ integration: 'gmail', provider: 'google' }]),
      wf('b', [{ integration: 'gmail', provider: 'google' }]),
    ])
    expect(list).toEqual([{ integration: 'gmail', connection: 'default', provider: 'google' }])
  })

  test('dedupes by (integration, connection) but keeps distinct connections', () => {
    const list = deriveConnectionList([
      wf('a', [{ integration: 'gmail', provider: 'google' }]),
      wf('b', [{ integration: 'gmail', connection: 'work', provider: 'google' }]),
    ])
    expect(list).toEqual([
      { integration: 'gmail', connection: 'default', provider: 'google' },
      { integration: 'gmail', connection: 'work', provider: 'google' },
    ])
  })

  test('workflows with no connections contribute nothing', () => {
    expect(deriveConnectionList([wf('a'), wf('b', [])])).toEqual([])
  })
})
```

- [ ] **Step 3: Run the test — verify it fails**

Run: `yarn test apps/inbox/server/connections.test.ts`
Expected: FAIL — `deriveConnectionList` is not exported.

- [ ] **Step 4: Implement the derivation + rewire `connectionList`**

Rewrite `apps/inbox/server/connections.ts`:

```ts
import type { ConnectionDescriptor } from '@atizar/server'
import type { WorkflowDescriptor } from '@atizar/core'
import { auth as gmailAuth } from '@atizar/integrations/gmail/auth'
import { workflowDescriptors } from '../workflows/index.js'

// The AuthSpec union's open catch-all variant ({ kind: string; [k]: unknown }) widens `scopes` to
// unknown even under the oauth2 narrowing, so read it through the oauth2 shape explicitly.
const gmailScopes = (gmailAuth as { scopes?: string[] }).scopes ?? []
const SCOPES: Record<string, string[]> = {
  gmail: gmailScopes,
}

export const scopesFor = (integration: string): string[] => SCOPES[integration] ?? []

// Union the connections each workflow declares, default `connection` to 'default', dedupe by
// (integration, connection). Deleting a workflow drops its connection; adding one surfaces it.
export function deriveConnectionList(descriptors: WorkflowDescriptor[]): ConnectionDescriptor[] {
  const byKey = new Map<string, ConnectionDescriptor>()
  for (const d of descriptors) {
    for (const c of d.connections ?? []) {
      const connection = c.connection ?? 'default'
      const key = `${c.integration}:${connection}`
      if (!byKey.has(key)) {
        byKey.set(key, { integration: c.integration, connection, provider: c.provider })
      }
    }
  }
  return [...byKey.values()]
}

export const connectionList: ConnectionDescriptor[] = deriveConnectionList(workflowDescriptors)
```

Verify the import path to the workflow aggregator: from `apps/inbox/server/connections.ts` the
aggregator is `apps/inbox/workflows/index.ts` → `'../workflows/index.js'` (check how
`apps/inbox/server/workflows.ts` imports descriptors — match its specifier style).

- [ ] **Step 5: Run the test — verify it passes**

Run: `yarn test apps/inbox/server/connections.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify the endpoint shape end-to-end with typecheck + full test**

Run: `yarn typecheck && yarn test`
Expected: PASS. (`connectionList` now resolves to `[{ integration:'gmail', connection:'default',
provider:'google' }]` because lead-inbox + email-inbox declare it; github-triage adds nothing.)

- [ ] **Step 7: Commit**

```bash
git add apps/inbox/server/connections.ts apps/inbox/server/connections.test.ts apps/inbox/workflows/lead-inbox/descriptor.ts apps/inbox/workflows/email-inbox/descriptor.ts
git commit -m "feat(inbox): derive connectionList by unioning workflow-declared connections"
```

---

## Task 3: Add a `link` icon to `@atizar/react` (2b prerequisite)

**Files:**
- Modify: `packages/react/src/components/Icon/Icon.tsx`

- [ ] **Step 1: Add `'link'` to `IconName` and a `PATHS` entry**

In `packages/react/src/components/Icon/Icon.tsx`: add `| 'link'` to the `IconName` union (near the
chrome glyphs), and add a `link` entry to the `PATHS` map. Use a standard chain-link glyph (two
overlapping rounded links) drawn on the same 24×24 viewBox / `stroke="currentColor"` convention the
other PATHS use — copy the stroke attributes (width, linecap) from a neighboring multi-path icon and
use these two paths:

```tsx
link: (
  <>
    <path d="M9 15l6-6" />
    <path d="M11 6l1-1a4 4 0 0 1 6 6l-2 2" />
    <path d="M13 18l-1 1a4 4 0 0 1-6-6l2-2" />
  </>
),
```

(Match the EXACT element shape the existing `PATHS` entries use — if they store a single `<path
d=.../>` string keyed by name, adapt accordingly; if they store JSX fragments, use the fragment
above. Read 2–3 existing entries first and mirror them precisely so the icon renders with the same
stroke styling.)

- [ ] **Step 2: Typecheck + a quick render check via the existing Icon usage**

Run: `yarn typecheck`
Expected: PASS (`'link'` is now a valid `IconName`).

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/components/Icon/Icon.tsx
git commit -m "feat(react): add link icon for the connections control"
```

---

## Task 4: Reshape `Connections` into a compact control + popover (2b)

**Files:**
- Modify: `packages/react/src/components/Connections/Connections.tsx`
- Modify: `packages/react/src/components/Connections/Connections.module.scss`
- Modify (if a popover hook helps): keep it inline — no new file unless the component grows past
  ~80 lines, then extract a `useConnectionsPopover.ts` co-located helper (folder-per-component rule).

**Behavior spec:**
- Render ONE button in place of the chip row: a `link` icon + a summary status dot + (when >1
  connection) a small count. Summary dot = accent/teal if ALL connected; amber/danger if ANY
  disconnected. (Zero connections: the button still renders; the popover shows an empty/"No
  connections" state — but in practice ≥1.)
- Clicking the button toggles a popover anchored under it, listing one `<ConnectionChip>` per
  connection (reuse the existing chip — it already shows dot + name + Connect/Disconnect).
- Popover closes on: outside click, Escape, or after a Disconnect refetch (optional — leave open is
  fine; closing on outside-click + Escape is the requirement).
- Header width is now constant regardless of connection count (the popover floats, doesn't grow the
  row).

- [ ] **Step 1: Write the failing test**

Extend `packages/react/src/components/Connections/Connections.test.tsx` (it exists). Mock
`useConnections` (the test already does, per the existing file — match its mocking style) to return
2 connections, one disconnected. Assert:
- Before click: the chip rows are NOT in the document (collapsed); a single toggle button IS
  (`getByRole('button', { name: /connections/i })` — give the button an `aria-label="Connections"`).
- The summary dot reflects "any disconnected" (assert a class or an `aria`/`title` — expose
  `title={allConnected ? 'All connected' : 'Action needed'}` on the button and assert it).
- After clicking the button: the connection rows (e.g. `getByText('gmail')`) ARE in the document.

(Read the existing `Connections.test.tsx` first and extend it in its own style; keep its current
assertions working or update them to the new collapsed-by-default behavior.)

- [ ] **Step 2: Run the test — verify it fails**

Run: `yarn test packages/react/src/components/Connections/Connections.test.tsx`
Expected: FAIL (no toggle button yet; rows render unconditionally today).

- [ ] **Step 3: Implement the compact control**

Rewrite `Connections.tsx`. Keep self-fetching via `useConnections`. Add:
- `const [open, setOpen] = useState(false)` + a `ref` on the wrapper for outside-click detection.
- A `useEffect` adding a `mousedown` listener (close when the click target is outside the ref) and a
  `keydown` listener (close on `Escape`); clean both up. (This is a standard popover dismissal —
  read `InstancePickerModal`/`Modal` for the house pattern if one exists; otherwise the inline
  effect is fine.)
- `const allConnected = connections.every((c) => c.connected)`.
- The button: `<button>` with `aria-label="Connections"`, `title`, containing
  `<Icon name="link" />`, a summary dot `<span className={clsx(s.summaryDot, allConnected ?
  s.ok : s.warn)} />`, and `{connections.length > 1 && <span className={s.count}>{length}</span>}`.
- The popover (rendered when `open`): a positioned `<div className={s.popover}>` containing the
  existing `connections.map(...)` of `<ConnectionChip>` (stacked vertically, not the inline row).

Keep the `disconnect` handler exactly as today (DELETE + `refetch`). Merge an incoming `className`
with `clsx` per the house rule if the component accepts one (it currently takes no props — keep it
propless unless the test needs otherwise).

- [ ] **Step 4: Update the SCSS module**

In `Connections.module.scss`: replace/extend `.connList` with the new classes — `.trigger` (the
button: inline-flex, gap, token-driven surface/border/radius, hover), `.summaryDot` (7×7 circle,
`--atz` token color), `.summaryDot.ok` (teal/accent), `.summaryDot.warn` (amber/danger token),
`.count` (small pill/number), `.popover` (absolute-positioned panel under the trigger:
`position: absolute; right: 0; top: calc(100% + 6px);` token surface bg, border, radius, soft
shadow, padding, `z-index` above the header's `z-index: 30`, `display: flex; flex-direction:
column; gap`). The wrapper needs `position: relative`. Use ONLY `--atz-*` tokens for colors/spacing
(camelCaseOnly: a `-`/`_` class camelizes — reference via `s.summaryDot`, `s.popover`, etc.).

- [ ] **Step 5: Run the test — verify it passes**

Run: `yarn test packages/react/src/components/Connections/Connections.test.tsx`
Expected: PASS.

- [ ] **Step 6: Full gate + build**

Run: `yarn typecheck && yarn test && yarn lint && yarn workspace @atizar/react build`
Expected: all PASS. Format your changed files: `git diff --name-only` then
`yarn prettier --write <those files>`.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/components/Connections
git commit -m "feat(react): collapse connections into one compact control with a popover"
```

---

## Task 5: Full green gate

- [ ] **Step 1: Run the full gate**

Run: `yarn typecheck && yarn test && yarn lint && yarn workspace @atizar/react build`
Expected: all PASS.

- [ ] **Step 2: format:check on changed files**

Run: `git diff --name-only master..HEAD -- '*.ts' '*.tsx' '*.scss' | xargs yarn prettier --check`
Expected: "All matched files use Prettier code style!" — else `yarn prettier --write` them and
commit `chore: format`.

---

## Browser verification (after Task 5, before merge)

Use the `browser-verify` skill. With `DEV_RECORD_REPLAY=1`:
1. **2b — compact control:** header shows ONE compact "Connections" button (icon + summary dot),
   NOT a chip row. Click it → a popover opens listing the gmail row with the correct
   connected/disconnected dot + Connect/Disconnect action.
2. **Outside-click / Escape** close the popover.
3. **2a — auto-derive:** `curl -s localhost:4000/api/connections` returns the gmail row (because
   lead-inbox + email-inbox declare it). This proves the union. (Optional deeper check: temporarily
   removing the connection from both descriptors → the row disappears; restore after.)
4. **Header width constant:** the header layout doesn't shift/grow vs. before (one fixed control).
5. No console errors; the summary dot color matches the connected state (teal when connected).

Disconnect flow: if a gmail credential exists, clicking Disconnect DELETEs + refetches and the dot
flips to "action needed". (If no live Gmail credential, the row shows "Connect" — verify that state
renders; do NOT perform a real OAuth connect.)

---

## Self-review checklist (run before merge)

- **Spec coverage:** 2a contract field (core) → Task 1; 2a server union+dedup+descriptor declares →
  Task 2; 2b compact control + popover → Tasks 3–4. ✓
- **Foundation:** Task 1 adds a field to the workflow contract (config-as-data, I7) — run
  `check-foundation` BEFORE Task 1 (the controller does this). Type in core, wiring in server. ✓
- **No data-layer change:** `useConnections` + the connect routes are untouched; only the
  presentation collapses. ✓
- **camelCaseOnly:** new SCSS classes referenced via `s.camelName`; no status-keyed `-`/`_` lookups
  that would silently fail. ✓
- **Folder-per-component (WS1):** `Connections` already in its own folder; the popover stays in it
  (or a co-located helper). ✓
