# gmail-viewer Integration + write-integration Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stage 1 of the email-inbox workflow spec (`docs/superpowers/specs/2026-06-11-email-inbox-workflow-design.md` §3): the `write-integration` dev skill, the `gmail-viewer` integration in `@platform/integrations`, the embedded `gmail-viewer` consumer skill, and `checkCredentials` on both gmail integrations.

**Architecture:** gmail-viewer mirrors gmail-basic exactly — pure injectable `.mjs` functions + hand-written `.d.ts` for TS consumers, a stdio MCP wrapper exposing READ tools only (mutations are server-executed effects, never model-visible), shared OAuth client reused from `gmail-basic/gmail-client.mjs`. The `write-integration` skill is authored FIRST and this build is its first validation run. No framework (`core`/`server`/`react`) change in this stage.

**Tech Stack:** plain ESM `.mjs` + `.d.ts`, vitest (fake gmail clients, no network), `@modelcontextprotocol/sdk`, `googleapis` (optional peer, already declared), yarn-classic workspace (no build step).

**Branch:** `feat/gmail-viewer` off `master`.

**Conventions that bind every task:** English-only content; Prettier/ESLint style (`semi:false`, single quotes); never `git add -A` — stage exact paths; commits end with the Claude trailer.

---

### Task 1: Branch + the `write-integration` Task skill

**Files:**
- Create: `.claude/skills/write-integration/SKILL.md`
- Modify: `.claude/skills/README.md` (register in the Tasks table)

- [ ] **Step 1: Create the branch**

```bash
git checkout -b feat/gmail-viewer
```

- [ ] **Step 2: Write `.claude/skills/write-integration/SKILL.md`**

This is a **Task** skill (owns a run end-to-end) per `.claude/skills/CONVENTIONS.md` Part 1 — so it MUST have the self-improvement stage (Part 2.1) and the check-foundation stage (Part 2.7). Recurrence (A4) is satisfied: gmail-basic was the first integration, gmail-viewer is the second.

```markdown
---
name: write-integration
description: Author a new integration module in @platform/integrations — pure injectable functions, an MCP wrapper for read tools, credentials health check, and an embedded consumer skill. Use when the user asks to add, write, or build an integration, connect an external service (Gmail, Slack, a CRM, an API), or extend an existing integration with new capabilities.
---

# Write an integration

Task skill — owns the run end-to-end: from "we need an integration that does X" to a
tested, documented module in `@platform/integrations` that agents and the server can
consume. The worked exemplar is `packages/integrations/src/gmail-viewer/` (built by this
skill's first run); `gmail-basic` is the original pattern source.

## The integration contract (FACTS — read before stage 1)

- **Pure functions, injectable client.** Every function is a plain ESM `.mjs` export that
  takes `(args, deps = {})` where `deps.getClient` (e.g. `getGmail`) overrides the real
  client. Tests pass a fake; the server imports the function directly (no MCP child).
- **Never throw — return `{ error }`.** Callers (server effects, MCP wrappers) branch on
  `res.error`. Use a shared `errText(err)` helper for messages.
- **Parsing is pure and separate.** Data-in/data-out helpers live in a `format.mjs` with no
  fs/env/network so they unit-test trivially.
- **Batch mutations are best-effort.** A multi-id action returns
  `{ done: string[], failed: { id, error }[] }` — one bad row must not abort the rest.
  A wholesale failure (client unavailable) returns `{ error }`.
- **`.d.ts` beside `.mjs`** for every module a TypeScript consumer imports; the package
  `exports` map points `types` at it. The package tsconfig has `allowJs:true, checkJs:false`
  — tests in `.test.ts` import `.mjs` directly.
- **MCP wrapper exposes READ tools only.** Mutations are server-executed effects behind
  approval gates; the model NEVER sees a mutating tool (the boot-time classification kernel
  enforces this — an unclassified tool refuses to boot). The wrapper is a thin stdio
  `McpServer` whose tools delegate to the pure functions.
- **`checkCredentials()` is mandatory.** Shape:
  `{ ok: true, ... } | { ok: false, error, hint }` — a cheap real ping (e.g. a 1-unit
  profile call). The `hint` names where credentials live and points at the integration's
  embedded skill. The server's health surface (spec F3) calls this.
- **Optional heavy peers.** A large SDK (`googleapis`) is an optional peerDependency,
  lazy-imported with a fail-fast error (`optional-peer.mjs` pattern).
- **Subpath exports, no build step.** Each module gets its own `exports` entry
  (`"./<name>/<fn>": { types, default }`); the root `./<name>` is the MCP server entry.
- **English-only**, Prettier/ESLint style of the repo.

## Stage 1 — Preflight (probe, don't ask)

Read the exemplar (`packages/integrations/src/gmail-viewer/`), the package `package.json`
exports map, and `packages/integrations/tsconfig.json`. If extending a service that already
has an integration, reuse its client module (gmail-viewer reuses
`gmail-basic/gmail-client.mjs`) — never duplicate auth code. Probe for FACTS yourself
(what the service API offers, what auth exists); ask only about INTENT.

## Stage 2 — Intent [GATE]

Confirm with the user, in one message: the integration name; the function list with each
function classified **read / mutation / health**; the credentials source; which
agent/workflow will consume it. Do NOT ask things the spec or code already answers.
Wait for confirmation before writing files.

## Stage 3 — TDD loop, one function at a time

For each function: write the failing vitest with a fake client FIRST → run it, see it fail
for the predicted reason → implement the minimal `.mjs` → green → write the `.d.ts` if a TS
consumer will import it → commit. Order: pure `format.mjs` helpers first, then reads, then
mutations, then `checkCredentials`.

## Stage 4 — MCP wrapper + exports

Write the stdio `index.mjs` (READ tools only — restate per tool why mutations are absent),
add all subpath `exports` entries, run `yarn typecheck && yarn test && yarn lint`.

## Stage 5 — Embedded consumer skill

Write `packages/integrations/skills/<name>/SKILL.md` (docs/AGENTIC.md A7 — ships with the
package, versioned with the code): what the integration does, how to wire reads vs effects
into an agent, where credentials come from and how to fix each `checkCredentials` failure.
Register nothing in `.claude/skills/README.md` for this one — consumer skills live with
their package; the repo index covers dev skills.

## Stage 6 — Validate

`yarn typecheck && yarn test && yarn lint && yarn format:check`. If real credentials exist
on this machine, run a live READ-ONLY smoke (the health check + one read). NEVER live-run
mutations from this skill — that is the consuming workflow's browser-E2E job (the
`browser-verify` procedure, invoked by the workflow build, not here — this skill's output
is a library, not running-app behavior).

## Stage 7 — Foundation check

Run the `check-foundation` procedure on the result (new package surface; verify no engine
import leaked into `@platform/core`, no mutation became model-visible). A conflict is a
STOP: warn the developer and get direct confirmation.

## Stage 8 — Self-improvement (last, silent skip is the default)

After commits land: did the user correct the same thing twice? Did a stage not match the
work? If nothing systemic surfaced, write one sentence ("Run went smoothly, nothing
systemic surfaced.") and exit. Otherwise propose 1–2 systemic changes to THIS skill (or to
a Procedure/Rule this run used), each quoting the motivating incident verbatim.
```

- [ ] **Step 3: Register the skill in `.claude/skills/README.md`**

Replace the placeholder row in the Tasks table:

```markdown
| Skill        | When to use                                         | SKILL.md |
| ------------ | --------------------------------------------------- | -------- |
| `write-integration` | Adding/writing/building an integration in `@platform/integrations`, connecting an external service, or extending an existing integration with new capabilities. | [write-integration/SKILL.md](write-integration/SKILL.md) |
```

(Keep the note that `add-workflow` is next in `docs/AGENTIC.md` Phase 1 — move it into the prose above the table if the placeholder row is gone.)

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/write-integration/SKILL.md .claude/skills/README.md
git commit -m "docs(skills): write-integration Task skill (first Task-genre skill)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: gmail-viewer `format.mjs` — `parseEmailMeta` (TDD)

**Files:**
- Create: `packages/integrations/src/gmail-viewer/format.mjs`
- Test: `packages/integrations/src/gmail-viewer/format.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseEmailMeta } from './format.mjs'

describe('parseEmailMeta', () => {
  it('extracts metadata fields from a metadata-format message', () => {
    const message = {
      id: 'm1',
      threadId: 't1',
      snippet: '  Quick question about pricing ',
      payload: {
        headers: [
          { name: 'From', value: 'lead@example.com' },
          { name: 'Subject', value: 'Pricing' },
          { name: 'Date', value: 'Wed, 11 Jun 2026 09:00:00 +0200' },
        ],
      },
    }
    expect(parseEmailMeta(message)).toEqual({
      messageId: 'm1',
      threadId: 't1',
      from: 'lead@example.com',
      subject: 'Pricing',
      date: 'Wed, 11 Jun 2026 09:00:00 +0200',
      snippet: 'Quick question about pricing',
    })
  })

  it('returns empty strings for missing headers and snippet', () => {
    expect(parseEmailMeta({ id: 'm2', threadId: 't2', payload: {} })).toEqual({
      messageId: 'm2',
      threadId: 't2',
      from: '',
      subject: '',
      date: '',
      snippet: '',
    })
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `yarn vitest run packages/integrations/src/gmail-viewer/format.test.ts`
Expected: FAIL — cannot resolve `./format.mjs`.

- [ ] **Step 3: Implement `format.mjs`**

```js
/**
 * Pure, network-free helpers for gmail-viewer.
 * No googleapis, no fs, no process.env — data in → data out.
 */

/**
 * Extract EmailRef metadata from a Gmail users.messages.get response
 * (format: 'metadata', headers From/Subject/Date).
 *
 * @param {object} message  Raw Gmail API message object.
 * @returns {{ messageId: string, threadId: string, from: string, subject: string,
 *             date: string, snippet: string }}
 */
export function parseEmailMeta(message) {
  const { id, threadId, snippet = '', payload = {} } = message
  const headers = payload.headers ?? []
  const getHeader = (name) => {
    const lower = name.toLowerCase()
    return headers.find((h) => h.name.toLowerCase() === lower)?.value ?? ''
  }
  return {
    messageId: id,
    threadId,
    from: getHeader('from'),
    subject: getHeader('subject'),
    date: getHeader('date'),
    snippet: snippet.trim(),
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `yarn vitest run packages/integrations/src/gmail-viewer/format.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/integrations/src/gmail-viewer/format.mjs packages/integrations/src/gmail-viewer/format.test.ts
git commit -m "feat(integrations): gmail-viewer parseEmailMeta (pure metadata parser)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `listUnread` (TDD)

**Files:**
- Create: `packages/integrations/src/gmail-viewer/list-unread.mjs`
- Create: `packages/integrations/src/gmail-viewer/list-unread.d.ts`
- Test: `packages/integrations/src/gmail-viewer/list-unread.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { listUnread } from './list-unread.mjs'

function fakeGmail(messages: { id: string }[]) {
  const calls: { listQ: string[]; gotIds: string[] } = { listQ: [], gotIds: [] }
  const gmail = {
    users: {
      messages: {
        list: async ({ q }: { q: string }) => {
          calls.listQ.push(q)
          return { data: { messages } }
        },
        get: async ({ id }: { id: string }) => {
          calls.gotIds.push(id)
          return {
            data: {
              id,
              threadId: `t-${id}`,
              snippet: `snippet ${id}`,
              payload: {
                headers: [
                  { name: 'From', value: `${id}@example.com` },
                  { name: 'Subject', value: `subject ${id}` },
                  { name: 'Date', value: 'Wed, 11 Jun 2026 09:00:00 +0200' },
                ],
              },
            },
          }
        },
      },
    },
  }
  return { gmail, calls }
}

describe('listUnread', () => {
  it('lists unread inbox emails of the last day as EmailRefs', async () => {
    const { gmail, calls } = fakeGmail([{ id: 'a' }, { id: 'b' }])
    const res = await listUnread({}, { getGmail: async () => gmail })
    if ('error' in res) throw new Error(res.error)
    expect(res.emails.map((e) => e.messageId)).toEqual(['a', 'b'])
    expect(res.emails[0]).toEqual({
      messageId: 'a',
      threadId: 't-a',
      from: 'a@example.com',
      subject: 'subject a',
      date: 'Wed, 11 Jun 2026 09:00:00 +0200',
      snippet: 'snippet a',
    })
    expect(calls.listQ[0]).toContain('in:inbox')
    expect(calls.listQ[0]).toContain('is:unread')
    expect(calls.listQ[0]).toContain('newer_than:1d')
  })

  it('rounds sinceHours up to whole days (Gmail search has no hour granularity)', async () => {
    const { gmail, calls } = fakeGmail([])
    await listUnread({ sinceHours: 72 }, { getGmail: async () => gmail })
    expect(calls.listQ[0]).toContain('newer_than:3d')
  })

  it('returns { emails: [] } when nothing is unread', async () => {
    const { gmail } = fakeGmail([])
    const res = await listUnread({}, { getGmail: async () => gmail })
    expect(res).toEqual({ emails: [] })
  })

  it('returns { error } when the client is unavailable', async () => {
    const res = await listUnread(
      {},
      {
        getGmail: async () => {
          throw new Error('no creds')
        },
      }
    )
    expect('error' in res && res.error).toMatch(/no creds/)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `yarn vitest run packages/integrations/src/gmail-viewer/list-unread.test.ts`
Expected: FAIL — cannot resolve `./list-unread.mjs`.

- [ ] **Step 3: Implement `list-unread.mjs`**

```js
import { parseEmailMeta } from './format.mjs'
import { errText } from '../gmail-basic/format.mjs'
import { getGmail as defaultGetGmail } from '../gmail-basic/gmail-client.mjs'

// Hard cap on returned emails — bounds the sorter's payload (the email-inbox spec
// keeps bodies out; metadata for 25 emails is small).
const MAX_RESULTS = 25

// Pure, importable read: unread inbox emails from the last `sinceHours` (default 24),
// metadata + snippet only — NO bodies (the consumer fetches a body via getEmail).
// Gmail search has day granularity only, so hours round UP to whole days.
// Returns { emails: EmailRef[] } or { error }.
export async function listUnread({ sinceHours = 24 } = {}, deps = {}) {
  const getGmail = deps.getGmail ?? defaultGetGmail
  try {
    const gmail = await getGmail()
    const days = Math.max(1, Math.ceil(sinceHours / 24))
    const q = `in:inbox is:unread newer_than:${days}d`
    const list = await gmail.users.messages.list({ userId: 'me', q, maxResults: MAX_RESULTS })
    const emails = []
    for (const m of list.data.messages ?? []) {
      const meta = await gmail.users.messages.get({
        userId: 'me',
        id: m.id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      })
      emails.push(parseEmailMeta(meta.data))
    }
    return { emails }
  } catch (err) {
    return { error: errText(err) }
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `yarn vitest run packages/integrations/src/gmail-viewer/list-unread.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write `list-unread.d.ts`**

```ts
// Type declaration for list-unread.mjs (JS module — no TS source).
export type EmailRef = {
  messageId: string
  threadId: string
  from: string
  subject: string
  date: string
  snippet: string
}

export declare function listUnread(
  args?: { sinceHours?: number },
  deps?: { getGmail?: () => Promise<unknown> }
): Promise<{ emails: EmailRef[] } | { error: string }>
```

- [ ] **Step 6: Commit**

```bash
git add packages/integrations/src/gmail-viewer/list-unread.mjs packages/integrations/src/gmail-viewer/list-unread.d.ts packages/integrations/src/gmail-viewer/list-unread.test.ts
git commit -m "feat(integrations): gmail-viewer listUnread (unread inbox window, metadata only)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `getEmail` (TDD)

**Files:**
- Create: `packages/integrations/src/gmail-viewer/get-email.mjs`
- Create: `packages/integrations/src/gmail-viewer/get-email.d.ts`
- Test: `packages/integrations/src/gmail-viewer/get-email.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { getEmail } from './get-email.mjs'

describe('getEmail', () => {
  it('fetches one message and returns parsed fields including the full body', async () => {
    const gmail = {
      users: {
        messages: {
          get: async ({ id, format }: { id: string; format: string }) => {
            expect(id).toBe('m1')
            expect(format).toBe('full')
            return {
              data: {
                threadId: 't1',
                snippet: 'snip',
                payload: {
                  headers: [
                    { name: 'From', value: 'lead@example.com' },
                    { name: 'Subject', value: 'Pricing' },
                  ],
                  body: { data: Buffer.from('Full body here', 'utf8').toString('base64url') },
                },
              },
            }
          },
        },
      },
    }
    const res = await getEmail({ messageId: 'm1' }, { getGmail: async () => gmail })
    expect(res).toEqual({
      messageId: 'm1',
      threadId: 't1',
      from: 'lead@example.com',
      subject: 'Pricing',
      body: 'Full body here',
    })
  })

  it('returns { error } when the client throws', async () => {
    const res = await getEmail(
      { messageId: 'x' },
      {
        getGmail: async () => {
          throw new Error('nope')
        },
      }
    )
    expect('error' in res && res.error).toMatch(/nope/)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `yarn vitest run packages/integrations/src/gmail-viewer/get-email.test.ts`
Expected: FAIL — cannot resolve `./get-email.mjs`.

- [ ] **Step 3: Implement `get-email.mjs`** (reuses gmail-basic's full-message parser — same shape, plus the messageId)

```js
import { parseLatestMessage, errText } from '../gmail-basic/format.mjs'
import { getGmail as defaultGetGmail } from '../gmail-basic/gmail-client.mjs'

// Pure, importable read: one email by messageId with the full decoded text body.
// The REPLY agent calls this itself — bodies never ride through the sorter model.
// Returns { messageId, threadId, from, subject, body } or { error }.
export async function getEmail({ messageId }, deps = {}) {
  const getGmail = deps.getGmail ?? defaultGetGmail
  try {
    const gmail = await getGmail()
    const full = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' })
    return { messageId, ...parseLatestMessage(full.data) }
  } catch (err) {
    return { error: errText(err) }
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `yarn vitest run packages/integrations/src/gmail-viewer/get-email.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write `get-email.d.ts`**

```ts
// Type declaration for get-email.mjs (JS module — no TS source).
export declare function getEmail(
  args: { messageId: string },
  deps?: { getGmail?: () => Promise<unknown> }
): Promise<
  | { messageId: string; threadId: string; from: string; subject: string; body: string }
  | { error: string }
>
```

- [ ] **Step 6: Commit**

```bash
git add packages/integrations/src/gmail-viewer/get-email.mjs packages/integrations/src/gmail-viewer/get-email.d.ts packages/integrations/src/gmail-viewer/get-email.test.ts
git commit -m "feat(integrations): gmail-viewer getEmail (full body by messageId)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `markRead` / `trash` / `star` — best-effort batch mutations (TDD)

**Files:**
- Create: `packages/integrations/src/gmail-viewer/modify.mjs`
- Create: `packages/integrations/src/gmail-viewer/modify.d.ts`
- Test: `packages/integrations/src/gmail-viewer/modify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { markRead, trash, star } from './modify.mjs'

function fakeGmail(opts: { failIds?: string[] } = {}) {
  const calls: { modify: { id: string; requestBody: unknown }[]; trash: string[] } = {
    modify: [],
    trash: [],
  }
  const fail = new Set(opts.failIds ?? [])
  const gmail = {
    users: {
      messages: {
        modify: async ({ id, requestBody }: { id: string; requestBody: unknown }) => {
          if (fail.has(id)) throw new Error(`boom ${id}`)
          calls.modify.push({ id, requestBody })
          return { data: {} }
        },
        trash: async ({ id }: { id: string }) => {
          if (fail.has(id)) throw new Error(`boom ${id}`)
          calls.trash.push(id)
          return { data: {} }
        },
      },
    },
  }
  return { gmail, calls }
}

describe('markRead / star / trash', () => {
  it('markRead removes the UNREAD label per message', async () => {
    const { gmail, calls } = fakeGmail()
    const res = await markRead({ messageIds: ['a', 'b'] }, { getGmail: async () => gmail })
    expect(res).toEqual({ done: ['a', 'b'], failed: [] })
    expect(calls.modify[0]).toEqual({ id: 'a', requestBody: { removeLabelIds: ['UNREAD'] } })
  })

  it('star adds the STARRED label', async () => {
    const { gmail, calls } = fakeGmail()
    const res = await star({ messageIds: ['a'] }, { getGmail: async () => gmail })
    expect(res).toEqual({ done: ['a'], failed: [] })
    expect(calls.modify[0]).toEqual({ id: 'a', requestBody: { addLabelIds: ['STARRED'] } })
  })

  it('trash is best-effort: a failing row is collected, the rest proceed', async () => {
    const { gmail, calls } = fakeGmail({ failIds: ['bad'] })
    const res = await trash({ messageIds: ['a', 'bad', 'b'] }, { getGmail: async () => gmail })
    expect(res).toEqual({ done: ['a', 'b'], failed: [{ messageId: 'bad', error: 'boom bad' }] })
    expect(calls.trash).toEqual(['a', 'b'])
  })

  it('returns { error } wholesale when the client itself is unavailable', async () => {
    const res = await markRead(
      { messageIds: ['a'] },
      {
        getGmail: async () => {
          throw new Error('no creds')
        },
      }
    )
    expect('error' in res && res.error).toMatch(/no creds/)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `yarn vitest run packages/integrations/src/gmail-viewer/modify.test.ts`
Expected: FAIL — cannot resolve `./modify.mjs`.

- [ ] **Step 3: Implement `modify.mjs`**

```js
import { errText } from '../gmail-basic/format.mjs'
import { getGmail as defaultGetGmail } from '../gmail-basic/gmail-client.mjs'

// Best-effort batch mutations (the email-inbox spec §4): one bad row must not abort
// the rest — per-row failures are collected so the gate effect can report a summary.
// A wholesale failure (client unavailable) returns { error }.
async function perMessage(messageIds, deps, action) {
  const getGmail = deps.getGmail ?? defaultGetGmail
  let gmail
  try {
    gmail = await getGmail()
  } catch (err) {
    return { error: errText(err) }
  }
  const done = []
  const failed = []
  for (const messageId of messageIds) {
    try {
      await action(gmail, messageId)
      done.push(messageId)
    } catch (err) {
      failed.push({ messageId, error: errText(err) })
    }
  }
  return { done, failed }
}

// Remove the UNREAD label (mark as read).
export async function markRead({ messageIds }, deps = {}) {
  return perMessage(messageIds, deps, (gmail, id) =>
    gmail.users.messages.modify({ userId: 'me', id, requestBody: { removeLabelIds: ['UNREAD'] } })
  )
}

// Move to trash (reversible in Gmail for ~30 days — NOT a permanent delete).
export async function trash({ messageIds }, deps = {}) {
  return perMessage(messageIds, deps, (gmail, id) =>
    gmail.users.messages.trash({ userId: 'me', id })
  )
}

// Add the STARRED label.
export async function star({ messageIds }, deps = {}) {
  return perMessage(messageIds, deps, (gmail, id) =>
    gmail.users.messages.modify({ userId: 'me', id, requestBody: { addLabelIds: ['STARRED'] } })
  )
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `yarn vitest run packages/integrations/src/gmail-viewer/modify.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write `modify.d.ts`**

```ts
// Type declarations for modify.mjs (JS module — no TS source).
export type BatchActionResult =
  | { done: string[]; failed: { messageId: string; error: string }[] }
  | { error: string }

export declare function markRead(
  args: { messageIds: string[] },
  deps?: { getGmail?: () => Promise<unknown> }
): Promise<BatchActionResult>

export declare function trash(
  args: { messageIds: string[] },
  deps?: { getGmail?: () => Promise<unknown> }
): Promise<BatchActionResult>

export declare function star(
  args: { messageIds: string[] },
  deps?: { getGmail?: () => Promise<unknown> }
): Promise<BatchActionResult>
```

- [ ] **Step 6: Commit**

```bash
git add packages/integrations/src/gmail-viewer/modify.mjs packages/integrations/src/gmail-viewer/modify.d.ts packages/integrations/src/gmail-viewer/modify.test.ts
git commit -m "feat(integrations): gmail-viewer markRead/trash/star (best-effort batch mutations)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: `checkCredentials` in gmail-basic + re-export from gmail-viewer (TDD)

The OAuth client lives in `gmail-basic/gmail-client.mjs` and both integrations share the same account — so the health check is implemented ONCE in gmail-basic and re-exported by gmail-viewer (each gets its own subpath export, consumers don't know they share).

**Files:**
- Create: `packages/integrations/src/gmail-basic/check-credentials.mjs`
- Create: `packages/integrations/src/gmail-basic/check-credentials.d.ts`
- Create: `packages/integrations/src/gmail-viewer/check-credentials.mjs` (re-export)
- Create: `packages/integrations/src/gmail-viewer/check-credentials.d.ts` (re-export)
- Test: `packages/integrations/src/gmail-basic/check-credentials.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { checkCredentials } from './check-credentials.mjs'

describe('checkCredentials', () => {
  it('returns ok + the account email when the profile ping succeeds', async () => {
    const gmail = {
      users: { getProfile: async () => ({ data: { emailAddress: 'me@example.com' } }) },
    }
    const res = await checkCredentials({ getGmail: async () => gmail })
    expect(res).toEqual({ ok: true, email: 'me@example.com' })
  })

  it('returns ok:false with error + hint when auth fails', async () => {
    const res = await checkCredentials({
      getGmail: async () => {
        throw new Error('invalid_grant')
      },
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toMatch(/invalid_grant/)
      expect(res.hint).toMatch(/gmail-viewer\/SKILL\.md/)
    }
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `yarn vitest run packages/integrations/src/gmail-basic/check-credentials.test.ts`
Expected: FAIL — cannot resolve `./check-credentials.mjs`.

- [ ] **Step 3: Implement `gmail-basic/check-credentials.mjs`**

```js
import { errText } from './format.mjs'
import { getGmail as defaultGetGmail } from './gmail-client.mjs'

const HINT =
  'Gmail OAuth credentials are missing or expired. Keys are read from ' +
  '~/.gmail-mcp/gcp-oauth.keys.json + credentials.json (override via GMAIL_OAUTH_KEYS / ' +
  'GMAIL_OAUTH_CREDENTIALS). Setup guide: packages/integrations/skills/gmail-viewer/SKILL.md ' +
  '("Credentials").'

// Health check shared by gmail-basic and gmail-viewer (same OAuth client + account).
// A 1-quota-unit real ping — proves the token actually works, not just that files exist.
// Returns { ok: true, email } or { ok: false, error, hint }.
export async function checkCredentials(deps = {}) {
  const getGmail = deps.getGmail ?? defaultGetGmail
  try {
    const gmail = await getGmail()
    const profile = await gmail.users.getProfile({ userId: 'me' })
    return { ok: true, email: profile.data.emailAddress ?? '' }
  } catch (err) {
    return { ok: false, error: errText(err), hint: HINT }
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `yarn vitest run packages/integrations/src/gmail-basic/check-credentials.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the `.d.ts` + the gmail-viewer re-export pair**

`packages/integrations/src/gmail-basic/check-credentials.d.ts`:

```ts
// Type declaration for check-credentials.mjs (JS module — no TS source).
export declare function checkCredentials(deps?: {
  getGmail?: () => Promise<unknown>
}): Promise<{ ok: true; email: string } | { ok: false; error: string; hint: string }>
```

`packages/integrations/src/gmail-viewer/check-credentials.mjs`:

```js
// gmail-viewer shares gmail-basic's OAuth client and account — one health check serves both.
export { checkCredentials } from '../gmail-basic/check-credentials.mjs'
```

`packages/integrations/src/gmail-viewer/check-credentials.d.ts`:

```ts
export { checkCredentials } from '../gmail-basic/check-credentials.js'
```

- [ ] **Step 6: Commit**

```bash
git add packages/integrations/src/gmail-basic/check-credentials.mjs packages/integrations/src/gmail-basic/check-credentials.d.ts packages/integrations/src/gmail-basic/check-credentials.test.ts packages/integrations/src/gmail-viewer/check-credentials.mjs packages/integrations/src/gmail-viewer/check-credentials.d.ts
git commit -m "feat(integrations): checkCredentials health check (gmail-basic, re-exported by gmail-viewer)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: MCP wrapper (read tools ONLY) + subpath exports

**Files:**
- Create: `packages/integrations/src/gmail-viewer/index.mjs`
- Modify: `packages/integrations/package.json` (exports map)

- [ ] **Step 1: Write the stdio MCP server `index.mjs`**

```js
// stdio MCP server launched by the `claude` CLI (--mcp-config): READ-ONLY Gmail
// inbox tools for the email-inbox sorter/reply agents. Mutations (markRead/trash/
// star) are SERVER-EXECUTED effects behind approval gates and are NEVER exposed
// to the model — the boot-time classification kernel enforces this.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { listUnread } from './list-unread.mjs'
import { getEmail } from './get-email.mjs'

const server = new McpServer({ name: 'gmail-viewer', version: '1.0.0' })

// Tool: list_unread — metadata + snippet only, no bodies (bounded payload).
server.registerTool(
  'list_unread',
  {
    description:
      'List unread inbox emails from the last N hours (default 24). Returns metadata + a short snippet per email — no bodies.',
    inputSchema: { sinceHours: z.number().int().positive().optional() },
  },
  async ({ sinceHours }) => {
    const res = await listUnread({ sinceHours })
    return { content: [{ type: 'text', text: JSON.stringify(res) }] }
  }
)

// Tool: get_email — the full text body of ONE email by id.
server.registerTool(
  'get_email',
  {
    description:
      'Fetch one email by messageId and return its parsed fields including the full text body.',
    inputSchema: { messageId: z.string() },
  },
  async ({ messageId }) => {
    const res = await getEmail({ messageId })
    return { content: [{ type: 'text', text: JSON.stringify(res) }] }
  }
)

await server.connect(new StdioServerTransport())
```

- [ ] **Step 2: Add the subpath exports to `packages/integrations/package.json`**

Replace the whole `exports` object with:

```json
"exports": {
  "./gmail-basic": "./src/gmail-basic/index.mjs",
  "./gmail-basic/format": "./src/gmail-basic/format.mjs",
  "./gmail-basic/create-draft": {
    "types": "./src/gmail-basic/create-draft.d.ts",
    "default": "./src/gmail-basic/create-draft.mjs"
  },
  "./gmail-basic/get-latest-email": {
    "types": "./src/gmail-basic/get-latest-email.d.ts",
    "default": "./src/gmail-basic/get-latest-email.mjs"
  },
  "./gmail-basic/check-credentials": {
    "types": "./src/gmail-basic/check-credentials.d.ts",
    "default": "./src/gmail-basic/check-credentials.mjs"
  },
  "./gmail-viewer": "./src/gmail-viewer/index.mjs",
  "./gmail-viewer/list-unread": {
    "types": "./src/gmail-viewer/list-unread.d.ts",
    "default": "./src/gmail-viewer/list-unread.mjs"
  },
  "./gmail-viewer/get-email": {
    "types": "./src/gmail-viewer/get-email.d.ts",
    "default": "./src/gmail-viewer/get-email.mjs"
  },
  "./gmail-viewer/modify": {
    "types": "./src/gmail-viewer/modify.d.ts",
    "default": "./src/gmail-viewer/modify.mjs"
  },
  "./gmail-viewer/check-credentials": {
    "types": "./src/gmail-viewer/check-credentials.d.ts",
    "default": "./src/gmail-viewer/check-credentials.mjs"
  }
}
```

- [ ] **Step 3: Full validation sweep**

Run: `yarn typecheck && yarn test && yarn lint && yarn format:check`
Expected: all green (typecheck builds composite refs; vitest runs the new tests among the workspace suite; if `format:check` flags the new files, run `yarn format` and re-check).

- [ ] **Step 4: Commit**

```bash
git add packages/integrations/src/gmail-viewer/index.mjs packages/integrations/package.json
git commit -m "feat(integrations): gmail-viewer stdio MCP wrapper (read tools only) + subpath exports

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Embedded consumer skill (`packages/integrations/skills/gmail-viewer/SKILL.md`)

The FIRST consumer skill (docs/AGENTIC.md A7 — ships in the package whose contract it teaches). Self-contained (A5), English, no self-improvement stage (it's reference for consumers, Procedure-shaped).

**Files:**
- Create: `packages/integrations/skills/gmail-viewer/SKILL.md`

- [ ] **Step 1: Write the skill**

```markdown
---
name: gmail-viewer
description: How to use the @platform/integrations gmail-viewer integration — wiring its read tools into an agent, executing its mutations as server effects, setting up Gmail OAuth credentials, and diagnosing checkCredentials failures. Use when importing gmail-viewer, adding Gmail capabilities to a workflow, or when an agent shows "missing credentials" for Gmail.
---

# gmail-viewer — how to use

Read + act on a Gmail inbox: list unread emails, fetch one email's body, mark read,
trash, star. Reads go to the model as tools; mutations are SERVER-EXECUTED effects
behind approval gates — never expose them to a model.

## Surface

| import | function | kind |
|---|---|---|
| `@platform/integrations/gmail-viewer/list-unread` | `listUnread({ sinceHours? })` → `{ emails: EmailRef[] } \| { error }` | read |
| `@platform/integrations/gmail-viewer/get-email` | `getEmail({ messageId })` → parsed email incl. `body` | read |
| `@platform/integrations/gmail-viewer/modify` | `markRead\|trash\|star({ messageIds })` → `{ done, failed } \| { error }` | mutation |
| `@platform/integrations/gmail-viewer/check-credentials` | `checkCredentials()` → `{ ok, email } \| { ok:false, error, hint }` | health |
| `@platform/integrations/gmail-viewer` | stdio MCP server: `list_unread`, `get_email` (READ ONLY) | model tools |

`EmailRef = { messageId, threadId, from, subject, date, snippet }`. Mutations are
best-effort per message: `failed` lists per-id errors; `{ error }` means the client
itself was unavailable. `trash` moves to Gmail Trash (reversible ~30 days), it never
permanently deletes.

## Wiring rules

- **Model side (claude-cli):** add the MCP server to the spawn's `--mcp-config` and put
  ONLY the read tools on the agent's allow-list (`mcp__gmail-viewer__list_unread`,
  `mcp__gmail-viewer__get_email`); declare them in `defineAgent.readonly`.
- **Model side (Mastra):** register `listUnread`/`getEmail` as native read tools.
- **Mutations:** bind them as `ServerBinding.effects` keyed by the approval tool name —
  the server calls `markRead`/`trash`/`star` AFTER a human approves a gate. Never put a
  mutation on a model allow-list; the framework refuses to boot on an unclassified tool.
- **Health:** call `checkCredentials()` in your server's health surface; show its `hint`
  to the user when not ok.

## Credentials

OAuth client + token files, read at call time:

- `~/.gmail-mcp/gcp-oauth.keys.json` — the OAuth client (GCP Console → APIs & Services →
  Credentials → OAuth client ID, type Desktop; download the JSON). Override path with
  `GMAIL_OAUTH_KEYS`.
- `~/.gmail-mcp/credentials.json` — the user token (an OAuth2 grant for the account, scope
  `https://www.googleapis.com/auth/gmail.modify` — covers read, labels, trash, drafts).
  Override path with `GMAIL_OAUTH_CREDENTIALS`.
- `googleapis` is an optional peer — `yarn add googleapis` in the consuming app.

## Diagnosing checkCredentials failures

| error contains | meaning | fix |
|---|---|---|
| `ENOENT` … `gcp-oauth.keys.json` | no OAuth client file | create/download the client JSON (above) |
| `ENOENT` … `credentials.json` | no user token | run your OAuth flow for the account with scope `gmail.modify` |
| `invalid_grant` | token expired/revoked | re-run the OAuth flow; replace credentials.json |
| `insufficient.*scope` / 403 | token has a narrower scope | re-grant with `gmail.modify` |
| `Optional dependency "googleapis" is not installed` | peer missing | `yarn add googleapis` |
```

- [ ] **Step 2: Commit**

```bash
git add packages/integrations/skills/gmail-viewer/SKILL.md
git commit -m "docs(integrations): gmail-viewer embedded consumer skill (first A7 consumer skill)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Live read-only smoke (gated on local credentials)

Real-credentials proof that the integration works against the live API. READ-ONLY — never run the mutations here (that's the workflow build's browser E2E, stage 3 of the spec).

- [ ] **Step 1: Run the health check live**

```bash
yarn tsx -e "const m = await import('@platform/integrations/gmail-viewer/check-credentials'); console.log(JSON.stringify(await m.checkCredentials(), null, 2))"
```

Expected: `{ "ok": true, "email": "<the account>" }`. If `ok:false` with an ENOENT hint and this machine genuinely has no `~/.gmail-mcp/` — record the smoke as SKIPPED (honestly) and move on; the unit suite still covers the logic. On this dev machine credentials exist (CLAUDE.md), so expect ok.

- [ ] **Step 2: Run listUnread + getEmail live**

```bash
yarn tsx -e "
const { listUnread } = await import('@platform/integrations/gmail-viewer/list-unread')
const res = await listUnread({ sinceHours: 168 })
if (res.error) throw new Error(res.error)
console.log('unread last 7d:', res.emails.length)
if (res.emails[0]) {
  const { getEmail } = await import('@platform/integrations/gmail-viewer/get-email')
  const full = await getEmail({ messageId: res.emails[0].messageId })
  console.log('first email body length:', full.error ?? full.body.length)
}
"
```

Expected: a count ≥ 0 and, if any unread email exists, a body length (no error thrown). NOTE: output prints only counts/lengths — never paste real email content into logs or commits.

- [ ] **Step 3: Record the result** — note PASS/SKIP in the final-task HANDOFF update text (Task 10).

---

### Task 10: Docs, foundation check, self-improvement, wrap-up

**Files:**
- Modify: `docs/AGENTIC.md` (as-built notes)
- Modify: `HANDOFF.md` (new-track section)

- [ ] **Step 1: Update `docs/AGENTIC.md`**

Add to the Phase-1/roadmap area (next to the existing ✅ entries, matching their style):

```markdown
- ✅ **`write-integration` Task skill** — BUILT (2026-06-11), the first Task-genre skill
  (`.claude/skills/write-integration/`). Validated by its first real run: gmail-viewer
  (`packages/integrations/src/gmail-viewer/` — listUnread/getEmail reads, markRead/trash/star
  best-effort mutations, shared checkCredentials in gmail-basic, read-only MCP wrapper).
- ✅ **First A7 consumer skill** — BUILT (2026-06-11):
  `packages/integrations/skills/gmail-viewer/SKILL.md` (how-to-use + credentials + failure
  table). A3's "after the contracts stabilize" is met for the integrations contract; the
  spec's F3 health `hint` points at this file.
```

- [ ] **Step 2: Update `HANDOFF.md`**

Insert directly ABOVE the line `**Starting point for the next session = beta build order step 7, sub-step 7c**`:

```markdown
### 🆕 ACTIVE TRACK (2026-06-11) — email-inbox workflow before the packaging tail

Spec → `docs/superpowers/specs/2026-06-11-email-inbox-workflow-design.md` (the new flagship
demo: sorter machine-dispatches REPLY-per-email + READER/SPAM/IMPORTANT batch agents; batch
gates with per-row actions; all Gmail mutations are server effects). 7c packaging resumes
AFTER this track, with email-inbox as the demo. Build stages → spec §6.

- **Stage 1 — gmail-viewer + write-integration skill: ✅ BUILT** on `feat/gmail-viewer`
  (2026-06-11). Plan → `docs/superpowers/plans/2026-06-11-gmail-viewer-integration.md`.
  As-built: `@platform/integrations/gmail-viewer/*` (listUnread/getEmail/modify/
  check-credentials subpaths + read-only MCP `index.mjs`); `checkCredentials` lives in
  gmail-basic (shared OAuth client), re-exported by gmail-viewer; `write-integration`
  Task skill + first A7 consumer skill (`packages/integrations/skills/gmail-viewer/`).
  Live read-only smoke: <PASS with N unread / SKIPPED — no creds>. Mutations are
  unit-tested only — their live verification is stage 3's browser E2E.
- **Stage 2 — core/server capabilities (NEXT):** F1 workflow prompt, F2 `dispatches` tool
  class + RunObserver→deliver, F3 health surface (wire `checkCredentials` per agent),
  F4 activity feed, F6 singleton START guard, `POST /api/cancel-all`. Spec §2.
```

(Replace the `<PASS … / SKIPPED …>` placeholder with the actual Task-9 result.)

- [ ] **Step 3: Foundation check**

Invoke the `check-foundation` skill on the stage's diff. Expected verdict: CLEAR — this stage adds a batteries package + skills; it must NOT have touched `@platform/core`/`providers`/`server`/`react` or made a mutation model-visible (the MCP wrapper exposes reads only). Any WARN → stop and surface to the user before merging.

- [ ] **Step 4: Final validation + commit docs**

```bash
yarn typecheck && yarn test && yarn lint && yarn format:check
git add docs/AGENTIC.md HANDOFF.md
git commit -m "docs(handoff): gmail-viewer + write-integration built (email-inbox stage 1); next = stage 2

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: write-integration self-improvement stage (first run!)**

Per the skill's Stage 8: honest analysis of THIS run (did any stage misfit the gmail-viewer build? did the user correct anything systemic?). Nothing systemic → one sentence and done. A real finding → amend `.claude/skills/write-integration/SKILL.md` (quote the incident verbatim) and commit as `docs(skills): write-integration post-run amendment`.

---

## Self-review notes (already applied)

- **Spec coverage:** §3 table — listUnread/getEmail/markRead/trash/star/checkCredentials = Tasks 3–6; MCP wrapper = Task 7; the two skills = Tasks 1, 8; "Mastra tool registrations" from §3 belong to stage 3 (the workflow wiring), NOT this plan — deliberately absent.
- **No Mastra/server wiring here:** stage 1 is "pure integration work, no framework change" (spec §6.1).
- **Type consistency:** `EmailRef` defined once (`list-unread.d.ts`), `BatchActionResult` once (`modify.d.ts`); `deps.getGmail` signature identical across modules; viewer re-export `.d.ts` uses the `.js` specifier (TS resolves `check-credentials.js` → the sibling `.d.ts`).
- **Live smoke is read-only by design**; mutation live-verification is explicitly stage 3's browser E2E.
