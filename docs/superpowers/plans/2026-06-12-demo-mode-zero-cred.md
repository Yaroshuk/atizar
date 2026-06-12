# Zero-credential `DEMO=1` mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `git clone … && yarn install && DEMO=1 yarn dev` drives the flagship **email-inbox** workflow end-to-end in the browser with zero credentials and no Docker.

**Architecture:** One unprefixed `DEMO` env flag (sibling of `DEV_RECORD_REPLAY`) read via `isDemo()` in `@platform/server`. It selects: PGlite in-memory DB (vs Docker Postgres), strict synthetic-cassette replay from a committed `demo-cassettes/` dir (vs real claude), demo fake-success effect stubs (vs real Gmail), and email-inbox-only workflow registration surfaced through a new `GET /api/config` the client reads to filter tabs + hide the Connect chip.

**Tech Stack:** TypeScript, Hono, drizzle-orm (`postgres-js` + `pglite` drivers), `@electric-sql/pglite`, Vitest, React/Vite.

**Spec:** `docs/superpowers/specs/2026-06-12-demo-mode-zero-cred-design.md`. Branch: `feat/7c-packaging`.

**Conventions reminder:** run vitest from repo root (`npx vitest run -c vitest.config.ts <file>`); the workspace `test` script already injects `-c`. `yarn typecheck` / `yarn lint` from root. Stage specific paths (never `git add -A`). Commit messages end with the `Co-Authored-By: Claude Opus 4.8 (1M context)` trailer.

---

## File Structure

- `packages/server/src/env.ts` — add `isDemo()` (standalone export).
- `packages/server/src/db/client.ts` — driver selection (postgres-js vs pglite), lazy pglite.
- `packages/server/src/db/migrate.ts` — migrator selection (postgres-js vs pglite migrator).
- `packages/server/package.json` — `@electric-sql/pglite` optionalDependency.
- `packages/server/src/index.ts` (barrel) — export `isDemo`.
- `apps/inbox/server/record-replay.ts` — `'demo'` strict mode + `demoCassettesDir()` + `DemoCassetteMissing`.
- `apps/inbox/server/build-agent.ts` — choose demo mode + dir when `isDemo()`.
- `apps/inbox/workflows/email-inbox/server.ts` — demo fake-success effect stubs.
- `apps/inbox/server/index.ts` — filter workflow registration to email-inbox in demo + `GET /api/config`.
- `apps/inbox/server/workflows.ts` — (read) the workflow→server map the filter uses.
- `packages/react/src/components/AppHeader.tsx` + `WorkflowBoard` (`InboxView`) — `demo` prop hides the Connect chip.
- `apps/inbox/client/src/App.tsx` — fetch `/api/config`, filter `workflowsConfig.workflows`, pass `demo`.
- `apps/inbox/demo-cassettes/email-inbox__*.jsonl` — NEW, committed, synthetic.
- `apps/inbox/package.json` — `demo` + `demo:scan-cassettes` scripts; `predev` skips postgres in demo.
- `apps/inbox/server/scan-demo-cassettes.ts` — NEW, the scanCassette CI gate runner.

---

## Task 1: `isDemo()` env helper

**Files:**
- Modify: `packages/server/src/env.ts`
- Modify: `packages/server/src/index.ts` (barrel export)
- Test: `packages/server/src/env.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/env.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { isDemo } from './env.js'

describe('isDemo', () => {
  const prev = process.env.DEMO
  afterEach(() => {
    if (prev === undefined) delete process.env.DEMO
    else process.env.DEMO = prev
  })

  it('is true only when DEMO is exactly "1"', () => {
    process.env.DEMO = '1'
    expect(isDemo()).toBe(true)
  })

  it('is false when DEMO is unset', () => {
    delete process.env.DEMO
    expect(isDemo()).toBe(false)
  })

  it('is false for other truthy strings (avoids accidental demo in prod)', () => {
    process.env.DEMO = 'true'
    expect(isDemo()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run -c vitest.config.ts packages/server/src/env.test.ts`
Expected: FAIL — `isDemo` is not exported.

- [ ] **Step 3: Add the helper**

In `packages/server/src/env.ts`, append below the `atizarEnv` object (it is intentionally NOT a member of `atizarEnv` — `DEMO` is an unprefixed dev/demo tooling flag, the same class as `DEV_RECORD_REPLAY`):

```typescript
// DEMO is a dev/demo tooling flag (NOT an ATIZAR_ runtime var — same class as DEV_RECORD_REPLAY),
// so it is read here as a standalone helper, not on atizarEnv. `DEMO=1` ⇒ zero-credential demo mode
// (PGlite in-memory, strict synthetic-cassette replay, fake effects, email-inbox only).
export function isDemo(): boolean {
  return process.env.DEMO === '1'
}
```

- [ ] **Step 4: Export from the barrel**

In `packages/server/src/index.ts`, add `isDemo` to the existing export from `./env.js` (find the line exporting `atizarEnv` / `databaseUrl` and add `isDemo`). If env is re-exported as `export { atizarEnv } from './env.js'`, change to `export { atizarEnv, isDemo } from './env.js'`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run -c vitest.config.ts packages/server/src/env.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/env.ts packages/server/src/env.test.ts packages/server/src/index.ts
git commit -m "feat(7c-B): isDemo() env helper (unprefixed DEMO flag)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: PGlite in-memory DB driver (lazy/optional) + migrator

**Files:**
- Modify: `packages/server/src/db/client.ts`
- Modify: `packages/server/src/db/migrate.ts`
- Modify: `packages/server/package.json` (add optionalDependency)
- Test: `packages/server/src/db/pglite.test.ts` (create)

**Context:** `db` is created at module load and imported everywhere; `Db = typeof db`. To keep
PGlite optional (only demo needs it) we lazy-load it via top-level await ONLY in demo, and type `db`
as the postgres-js database type (the two drizzle drivers expose the same schema-typed query API;
the pglite db is cast to that type — the runtime calls used by StateStore are compatible).

- [ ] **Step 1: Add the optional dependency**

In `packages/server/package.json`, add (create the block if absent):

```json
  "optionalDependencies": {
    "@electric-sql/pglite": "^0.2.0"
  }
```

Then install: `yarn install --ignore-engines`. Verify `node -e "require('@electric-sql/pglite/package.json')"` prints a version.

- [ ] **Step 2: Write the failing test**

Create `packages/server/src/db/pglite.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

describe('PGlite demo DB', () => {
  it('builds an in-memory drizzle db and migrate-on-boot creates the work_items table', async () => {
    process.env.DEMO = '1'
    // Import AFTER setting DEMO so the module picks the pglite branch.
    const { db } = await import('./client.js')
    const { runMigrations } = await import('./migrate.js')
    await runMigrations()
    // A trivial select proves the schema exists and the driver is wired.
    const rows = await db.query.workItems.findMany({ limit: 1 })
    expect(Array.isArray(rows)).toBe(true)
    delete process.env.DEMO
  })
})
```

NOTE for the implementer: this test mutates module-level state (the DB singleton) — run it in isolation (`npx vitest run -c vitest.config.ts packages/server/src/db/pglite.test.ts`). Do NOT add it to a file that also imports the postgres-js `db`.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run -c vitest.config.ts packages/server/src/db/pglite.test.ts`
Expected: FAIL — client.js still builds postgres-js and tries to connect to localhost:5432 (connection error) or the pglite branch is missing.

- [ ] **Step 4: Implement driver selection in `client.ts`**

Replace the body of `packages/server/src/db/client.ts` with:

```typescript
import * as schema from './schema.js'
import { atizarEnv, isDemo } from '../env.js'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

export const databaseUrl = atizarEnv.databaseUrl()

// `Db` is the postgres-js typed database; in demo the pglite db is cast to it (both drizzle
// drivers expose the same schema-typed query/insert/update/transaction API the StateStore uses).
export type Db = PostgresJsDatabase<typeof schema>

let _db: Db
let _close: () => Promise<void>

if (isDemo()) {
  // Lazy-load the optional pglite peer (only demo needs it) — keeps prod free of the dep.
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const client = new PGlite() // in-memory; fresh each boot
  _db = drizzle(client, { schema }) as unknown as Db
  _close = async () => {
    await client.close()
  }
} else {
  const { default: postgres } = await import('postgres')
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const sql = postgres(databaseUrl)
  _db = drizzle(sql, { schema })
  _close = async () => {
    await sql.end({ timeout: 5 })
  }
}

export const db: Db = _db

export async function closeDb(): Promise<void> {
  await _close()
}
```

If `tsc` rejects the `as unknown as Db` cast on the pglite db, that is the single judgment point — keep the cast minimal and adjust only its right-hand type to satisfy the installed drizzle types (do NOT widen `Db` to a union; StateStore relies on the single postgres-js type).

- [ ] **Step 5: Implement migrator selection in `migrate.ts`**

In `packages/server/src/db/migrate.ts`, replace the static migrator import with a demo-aware selection inside `runMigrations`:

Remove the top import line `import { migrate } from 'drizzle-orm/postgres-js/migrator'` and change `runMigrations` to:

```typescript
export async function runMigrations(): Promise<void> {
  const { migrate } = isDemo()
    ? await import('drizzle-orm/pglite/migrator')
    : await import('drizzle-orm/postgres-js/migrator')
  await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER })
  await db
    .insert(schemaMeta)
    .values({ key: 'schema_version', value: SCHEMA_VERSION })
    .onConflictDoUpdate({ target: schemaMeta.key, set: { value: SCHEMA_VERSION } })
}
```

Add `import { isDemo } from '../env.js'` at the top. The `db as never` cast lets the one
`migrate` call accept either migrator's db-parameter type (the two migrators have different
nominal db types but the same migrations folder runs on both — same Postgres dialect).

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run -c vitest.config.ts packages/server/src/db/pglite.test.ts`
Expected: PASS — `db.query.workItems.findMany` returns `[]` against the freshly-migrated in-memory DB.

- [ ] **Step 7: Verify the non-demo path still typechecks/tests**

Run: `yarn typecheck` (expect Done) and `npx vitest run -c vitest.config.ts packages/server/src/workerPool.test.ts` (a non-DB server test, expect PASS) to confirm the postgres-js branch is intact.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/db/client.ts packages/server/src/db/migrate.ts packages/server/src/db/pglite.test.ts packages/server/package.json package.json yarn.lock
git commit -m "feat(7c-B): PGlite in-memory DB driver for demo mode (lazy optional peer)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Strict synthetic-cassette replay mode

**Files:**
- Modify: `apps/inbox/server/record-replay.ts`
- Modify: `apps/inbox/server/build-agent.ts`
- Test: `apps/inbox/server/record-replay.demo.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/inbox/server/record-replay.demo.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { withRecordReplay } from './record-replay.js'
import type { Provider } from '@platform/core'

// A provider that MUST NOT be called in demo mode (a real claude stand-in).
const exploding: Provider = {
  async *run() {
    throw new Error('real provider was called in demo mode — should never happen')
  },
}

describe('demo strict replay', () => {
  it('throws DemoCassetteMissing instead of calling the real provider on a miss', async () => {
    const wrapped = withRecordReplay(exploding, {
      key: 'no-such-agent',
      approvalNames: [],
      dir: '/tmp/aiwf-nonexistent-cassettes',
      mode: 'demo',
    })
    const iter = wrapped.run({ messages: [] } as never)
    await expect(async () => {
      for await (const _e of iter) void _e
    }).rejects.toThrow(/DemoCassetteMissing/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run -c vitest.config.ts apps/inbox/server/record-replay.demo.test.ts`
Expected: FAIL — `'demo'` is not an accepted mode (type error or the exploding provider is called).

- [ ] **Step 3: Add the `'demo'` mode + helpers**

In `apps/inbox/server/record-replay.ts`:

(a) widen the mode type:

```typescript
export type RecordReplayMode = 'replay' | 'record' | 'demo'
```

(b) add a demo cassette dir helper next to `cassettesDir`:

```typescript
// apps/inbox/demo-cassettes/ — committed SYNTHETIC cassettes for DEMO=1 (never real data).
export function demoCassettesDir(): string {
  return fileURLToPath(new URL('../demo-cassettes/', import.meta.url))
}
```

(c) in BOTH the `run` and `resume` branches, change the replay guard so `'demo'` reads the step and HARD-FAILS on a miss (never falls through to the real provider). Replace the two `if (opts.mode === 'replay') { … }` blocks with:

```typescript
      if (opts.mode === 'replay' || opts.mode === 'demo') {
        const recorded = await store.readStep(step)
        if (recorded) {
          yield* recorded
          return
        }
        if (opts.mode === 'demo') {
          throw new Error(`DemoCassetteMissing: ${opts.key} step ${step} (demo-cassettes/${opts.key}.jsonl)`)
        }
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run -c vitest.config.ts apps/inbox/server/record-replay.demo.test.ts`
Expected: PASS — the miss throws `DemoCassetteMissing` and `exploding.run` is never reached.

- [ ] **Step 5: Wire demo mode in `build-agent.ts`**

In `apps/inbox/server/build-agent.ts`, import the demo helpers and select demo mode/dir first:

Change the import line to:

```typescript
import { withRecordReplay, recordReplayMode, cassettesDir, demoCassettesDir } from './record-replay.js'
import { isDemo } from '@platform/server'
```

Replace the `const mode = recordReplayMode()` block with:

```typescript
  const mode = isDemo() ? 'demo' : recordReplayMode()
  if (mode) {
    provider = withRecordReplay(provider, {
      key: instanceKey,
      approvalNames: def.approvals,
      dir: mode === 'demo' ? demoCassettesDir() : cassettesDir(),
      mode,
    })
  }
```

- [ ] **Step 6: Run the server test suite + typecheck**

Run: `npx vitest run -c vitest.config.ts apps/inbox/server/record-replay.test.ts apps/inbox/server/record-replay.demo.test.ts` and `yarn typecheck`
Expected: PASS / Done (existing replay tests unaffected).

- [ ] **Step 7: Commit**

```bash
git add apps/inbox/server/record-replay.ts apps/inbox/server/record-replay.demo.test.ts apps/inbox/server/build-agent.ts
git commit -m "feat(7c-B): strict demo replay mode (DemoCassetteMissing, demo-cassettes/ dir)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Demo fake-success effect stubs (email-inbox)

**Files:**
- Modify: `apps/inbox/workflows/email-inbox/server.ts`
- Test: `apps/inbox/workflows/email-inbox/server.demo.test.ts` (create)

**Context:** In demo there is no Gmail credential, so the `saveDraft` and `applyActions` effects must
short-circuit to a believable success shape BEFORE calling `resolveGmail`/`createDraft`/`applyEmailActions`.

- [ ] **Step 1: Write the failing test**

Create `apps/inbox/workflows/email-inbox/server.demo.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { emailInboxServer } from './server.js'

afterEach(() => delete process.env.DEMO)

describe('email-inbox effects in demo mode', () => {
  it('saveDraft returns a fake demo draftId without touching Gmail', async () => {
    process.env.DEMO = '1'
    const bindings = emailInboxServer()
    const reply = bindings.find((b) => b.effects?.saveDraft)
    const result = await reply!.effects!.saveDraft({ threadId: 't1', body: 'hi' }, {} as never)
    expect(result).toMatchObject({ ok: true })
    expect(String((result as { draftId?: string }).draftId)).toMatch(/^demo-/)
  })

  it('applyActions returns fake success counting the requested actions', async () => {
    process.env.DEMO = '1'
    const bindings = emailInboxServer()
    const batch = bindings.find((b) => b.effects?.applyActions)
    const result = await batch!.effects!.applyActions(
      { actions: [{ id: 'a', action: 'read' }, { id: 'b', action: 'read' }] },
      {} as never
    )
    expect(result).toMatchObject({ applied: 2, failed: [] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run -c vitest.config.ts apps/inbox/workflows/email-inbox/server.demo.test.ts`
Expected: FAIL — without the stub, `saveDraft` calls `resolveGmail()` → returns the "not connected" error shape (no `ok`/`draftId`).

- [ ] **Step 3: Add the demo stubs**

In `apps/inbox/workflows/email-inbox/server.ts`:

Add to the imports: `import { resolveCredential, atizarEnv, isDemo } from '@platform/server'` (add `isDemo` to the existing line).

Add a module-level counter + helpers above `emailInboxServer`:

```typescript
// In demo mode there is no Gmail credential; effects return a believable fake-success shape so the
// full approve→executed→finished path renders without touching Gmail. The counter makes draftIds
// look distinct across approvals within a session.
let demoDraftSeq = 0
const demoSaveDraft = () => ({ ok: true as const, draftId: `demo-${++demoDraftSeq}` })
const demoApplyActions = (form: Record<string, unknown>) => {
  const actions = Array.isArray(form.actions) ? form.actions : []
  const byAction: Record<string, number> = {}
  for (const a of actions as Array<{ action?: string }>) {
    const k = String(a?.action ?? 'unknown')
    byAction[k] = (byAction[k] ?? 0) + 1
  }
  return { applied: actions.length, failed: [] as unknown[], byAction }
}
```

In the `saveDraft` effect, add as the first line of the function body:

```typescript
        if (isDemo()) return demoSaveDraft()
```

In the `applyActions` effect, add as the first line of the function body:

```typescript
        if (isDemo()) return demoApplyActions(form)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run -c vitest.config.ts apps/inbox/workflows/email-inbox/server.demo.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/workflows/email-inbox/server.ts apps/inbox/workflows/email-inbox/server.demo.test.ts
git commit -m "feat(7c-B): demo fake-success effect stubs for email-inbox (no Gmail)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `GET /api/config` + email-inbox-only registration

**Files:**
- Modify: `apps/inbox/server/index.ts`
- Read first: `apps/inbox/server/index.ts` (the registration loop + `workflowServers` usage), `apps/inbox/server/workflows.ts`
- Test: manual curl (this is app wiring; covered by the browser E2E in Task 9 + the curl checks here)

**Context:** `apps/inbox/server/index.ts` registers every workflow's agents and mounts the pipeline +
connect routes. In demo we (a) register ONLY the `email-inbox` workflow's agents, and (b) expose
`GET /api/config` → `{ demo, workflows }` so the client can filter tabs.

- [ ] **Step 1: Read the current registration**

Read `apps/inbox/server/index.ts` fully and `apps/inbox/server/workflows.ts`. Identify the array/loop that iterates workflow servers (the `workflowServers` import) to register agents under `instanceId(wf, agent)`. Note the exact variable names.

- [ ] **Step 2: Filter registration to email-inbox in demo**

In `apps/inbox/server/index.ts`, add `isDemo` to the `@platform/server` import. Where the workflow-server list is iterated, derive the enabled set:

```typescript
const ENABLED_WORKFLOWS = isDemo() ? ['email-inbox'] : null // null = all
```

Filter the iteration so a workflow whose id is not in `ENABLED_WORKFLOWS` (when non-null) is skipped before registering its agents. (The workflow id is the descriptor `id` available next to each entry in `workflowServers` / `workflowDescriptors` — use whichever the loop already has in scope; do NOT invent a new lookup.)

- [ ] **Step 3: Add `GET /api/config`**

In `apps/inbox/server/index.ts`, after the Hono `app` is created and before `serve(...)`, add:

```typescript
app.get('/api/config', (c) =>
  c.json({
    demo: isDemo(),
    workflows: ENABLED_WORKFLOWS ?? workflowDescriptors.map((w) => w.id),
  })
)
```

If `workflowDescriptors` is not already imported in `index.ts`, import it from `../workflows/index.js` (match the existing import style; the client tab list is built from the same descriptors). If the ids live on a different shape, map that shape's id field instead — verify against Step 1.

- [ ] **Step 4: Verify by curl (demo + non-demo)**

Start the server in demo: `DEMO=1 yarn dev:server` (separate terminal or background). Then:

Run: `curl -s localhost:4000/api/config`
Expected: `{"demo":true,"workflows":["email-inbox"]}`

Stop it; start non-demo (needs Docker Postgres up): `yarn dev:server`, then `curl -s localhost:4000/api/config`
Expected: `{"demo":false,"workflows":["email-inbox","github-triage","lead-inbox"]}` (order per descriptors).

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/server/index.ts
git commit -m "feat(7c-B): GET /api/config + email-inbox-only registration in demo

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Client — fetch `/api/config`, filter tabs, hide Connect chip

**Files:**
- Modify: `packages/react/src/components/AppHeader.tsx` (accept + honor a `demo` prop that hides the Connect chip)
- Modify: `packages/react/src/components/InboxView.tsx` (the `WorkflowBoard` component) — thread a `demo` prop to `AppHeader`
- Modify: `apps/inbox/client/src/App.tsx` — fetch config, filter workflows, pass `demo`
- Read first: `packages/react/src/components/AppHeader.tsx`, the `WorkflowBoard` component, `apps/inbox/client/src/App.tsx`

**Context:** Tabs render from `config.workflows`. The Connect chip lives in `AppHeader`. The demo app
owns the fetch + filtering (userland decides what to show); `@platform/react` only gains a `demo` prop
to hide the chip.

- [ ] **Step 1: Read the three files** to learn the exact prop names (`WorkflowBoard` config prop, `AppHeader` props, where `ConnectionChip` is rendered).

- [ ] **Step 2: Add a `demo` prop to AppHeader that hides the Connect chip**

In `packages/react/src/components/AppHeader.tsx`, add `demo?: boolean` to its props type and wrap the `ConnectionChip`/Connect render in `{!demo && ( … )}`. (Find the JSX that renders the gmail chip — Step 1 — and gate it.)

- [ ] **Step 3: Thread `demo` through WorkflowBoard**

In the `WorkflowBoard` component (`InboxView.tsx`), add `demo?: boolean` to its props and pass it to `<AppHeader demo={demo} … />`. Export the prop on the component's public type.

- [ ] **Step 4: Demo-aware App shell**

Replace `apps/inbox/client/src/App.tsx` with a version that fetches `/api/config`, filters the workflows, and passes `demo`:

```typescript
import { useEffect, useState } from 'react'
import { WorkflowBoard } from '@platform/react'
import { workflowsConfig } from './workflows'

type Config = { demo: boolean; workflows: string[] }

export const App = () => {
  const [config, setConfig] = useState<Config | null>(null)

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((c: Config) => setConfig(c))
      .catch(() => setConfig({ demo: false, workflows: workflowsConfig.workflows.map((w) => w.id) }))
  }, [])

  if (!config) return null // brief load before config resolves (acceptable for the demo)

  const enabled = new Set(config.workflows)
  const filtered = {
    ...workflowsConfig,
    workflows: workflowsConfig.workflows.filter((w) => enabled.has(w.id)),
  }
  return <WorkflowBoard config={filtered} demo={config.demo} />
}
```

Verify the descriptor's id field is `.id` (Step 1 of Task 5); adjust if different.

- [ ] **Step 5: Typecheck + build**

Run: `yarn typecheck` and `yarn build`
Expected: Done / successful build (no type errors from the new `demo` prop or App changes).

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/components/AppHeader.tsx packages/react/src/components/InboxView.tsx apps/inbox/client/src/App.tsx
git commit -m "feat(7c-B): client reads /api/config — filter tabs + hide Connect chip in demo

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Author synthetic demo cassettes

**Files:**
- Create: `apps/inbox/demo-cassettes/email-inbox__sorter.jsonl`
- Create: `apps/inbox/demo-cassettes/email-inbox__reader.jsonl`
- Create: `apps/inbox/demo-cassettes/email-inbox__spam.jsonl`
- Create: `apps/inbox/demo-cassettes/email-inbox__important.jsonl`
- Create: `apps/inbox/demo-cassettes/email-inbox__reply.jsonl`
- Read first: an existing real cassette (`apps/inbox/.cassettes/email-inbox__sorter.jsonl`) for the exact event shapes per agent.

**Context:** Each file is one JSON object per line: `{"step":0,"event":{…AG-UI BaseEvent…}}`. The
cassette key = `wf__agent` (`email-inbox__sorter` etc.). Author with INVENTED identities only.

- [ ] **Step 1: Study the real cassette shapes**

Read `apps/inbox/.cassettes/email-inbox__sorter.jsonl` and `…__reader.jsonl` to copy the exact event sequence: text chunks, `TOOL_CALL_START`/`TOOL_CALL_ARGS`/`TOOL_CALL_END` for `renderSort`/`route_emails` (sorter) and `applyActions` (batch), and the `GATE_OPENED` custom event for the gate. The synthetic files must reproduce this SHAPE with invented content.

- [ ] **Step 2: Define the synthetic inbox (invented identities)**

Pick a coherent set the sorter routes deterministically, e.g.:
- `reader: 1` — "Weekly product digest" from `news@brightloop.example` (informational → mark read)
- `spam: 1` — "🎁 You won a $500 gift card" from `promo@deals-blast.example` (→ trash)
- `important: 1` — "Contract review before Friday" from `dana@northwind-legal.example` (→ star)
- `reply: 1` — "Question about your pricing tiers" from `sam@harborfreight.example` (→ draft reply)

Use stable invented threadIds (`demo-thread-1`…`demo-thread-4`). The sorter's `route_emails` args and `renderSort` summary reference exactly these; each child cassette references its own thread.

- [ ] **Step 3: Author `email-inbox__sorter.jsonl`**

Reproduce the real sorter shape with the synthetic decision: a `renderSort` tool call summarizing `reader:1, spam:1, important:1, reply:1`, then a `route_emails` tool call dispatching the four children with the invented from/subject/threadId, then a closing text chunk. Match the real file's event-type order and field names exactly.

- [ ] **Step 4: Author each child cassette**

For `reader`/`spam`/`important`: reproduce the batch shape — a short text chunk, an `applyActions` tool call proposing the action on its one synthetic email, then a `GATE_OPENED` event (`gateKind:'approval'`, `toolName:'applyActions'`, a `toolCallId` matching the `TOOL_CALL_START`, and `proposedArtifact` = the actions form). For `reply`: reproduce the reply shape — text, a `saveDraft` tool call with `{threadId:'demo-thread-4', body:'…'}`, then `GATE_OPENED` (`toolName:'saveDraft'`). Also add the `step:1` resume line(s) per agent (the closing narration after approval), mirroring how the real cassette stores step 1.

- [ ] **Step 5: Validate JSON**

Run: `for f in apps/inbox/demo-cassettes/*.jsonl; do echo "$f"; while read -r l; do echo "$l" | python3 -c "import sys,json;json.loads(sys.stdin.read())" || echo "BAD LINE in $f"; done < "$f"; done`
Expected: every line parses (no "BAD LINE").

- [ ] **Step 6: Commit**

```bash
git add apps/inbox/demo-cassettes/
git commit -m "feat(7c-B): synthetic demo cassettes for email-inbox (invented identities)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `scanCassette` CI gate + demo scripts

**Files:**
- Create: `apps/inbox/server/scan-demo-cassettes.ts`
- Modify: `apps/inbox/package.json` (scripts: `demo`, `demo:scan-cassettes`, demo-aware `predev`)
- Modify: CI config (the repo's workflow file under `.github/workflows/` if present — else document the command)
- Test: run the scanner over the authored cassettes (expect clean)

- [ ] **Step 1: Write the scanner runner**

Create `apps/inbox/server/scan-demo-cassettes.ts`:

```typescript
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { scanCassette } from './record-replay.js'

// CI gate: scan every committed synthetic demo cassette for accidental real PII
// (emails/phones/secrets patterns). Exit 1 on any finding. Names/addresses are not
// regex-detectable — the synthetic-authoring discipline + review cover those.
const dir = fileURLToPath(new URL('../demo-cassettes/', import.meta.url))
const files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl'))
let findings = 0
for (const f of files) {
  const text = await readFile(new URL(`../demo-cassettes/${f}`, import.meta.url), 'utf8')
  const hits = scanCassette(text) // returns the array of findings ({line, snippet, kind})
  for (const h of hits) {
    findings++
    console.error(`${f}: ${JSON.stringify(h)}`)
  }
}
if (findings > 0) {
  console.error(`\n[demo:scan-cassettes] ${findings} potential PII finding(s) — fix before commit.`)
  process.exit(1)
}
console.log(`[demo:scan-cassettes] ${files.length} cassette(s) clean.`)
```

Confirm `scanCassette`'s exact return shape against `record-replay.ts` (read its signature) and adapt the `console.error(JSON.stringify(h))` line to the real finding fields; if `scanCassette` is not exported, add it to the exports.

- [ ] **Step 2: Add the scripts**

In `apps/inbox/package.json`, add to `scripts`:

```json
    "demo": "DEMO=1 concurrently -n server,client -c blue,green \"npm:dev:server\" \"npm:dev:client\"",
    "demo:scan-cassettes": "tsx server/scan-demo-cassettes.ts"
```

Make `predev` skip Postgres in demo — change `predev` so the `ensure-postgres.sh` call is guarded:

```json
    "predev": "[ \"$DEMO\" = \"1\" ] || ../../scripts/ensure-postgres.sh; lsof -tiTCP:4000 -tiTCP:5173 -sTCP:LISTEN 2>/dev/null | xargs -I{} kill -9 {} 2>/dev/null; sleep 1; true",
```

(The `demo` script runs `dev:server`/`dev:client` directly, not `dev`, so it bypasses `predev` entirely — but guarding `predev` also makes `DEMO=1 yarn dev` safe.)

- [ ] **Step 3: Run the scanner over the authored cassettes**

Run: `cd apps/inbox && yarn demo:scan-cassettes`
Expected: `[demo:scan-cassettes] 5 cassette(s) clean.` (exit 0).

- [ ] **Step 4: Wire CI**

If `.github/workflows/*.yml` exists, add a step `run: yarn workspace inbox demo:scan-cassettes` after `yarn install` in the test job. If no CI config exists yet, add a top-level note in the spec/README that this command must run in CI; do NOT fabricate a CI file structure that doesn't match the repo.

- [ ] **Step 5: Commit**

```bash
git add apps/inbox/server/scan-demo-cassettes.ts apps/inbox/package.json
# plus any .github/workflows file if modified
git commit -m "feat(7c-B): demo:scan-cassettes CI gate + demo/predev scripts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Headline browser E2E (the acceptance test)

**Files:** none (verification). Use the `browser-verify` skill.

- [ ] **Step 1: Prove Docker independence**

Stop Postgres: `docker compose stop postgres`. Confirm `docker ps` shows no aiworkflow-postgres running.

- [ ] **Step 2: Clean the environment + start demo**

Per `browser-verify` Stage 1: kill stale stacks, free `:4000`/`:5173`. Then start: `yarn demo` from repo root (sets `DEMO=1`). Confirm ONE `server on http://localhost:4000`, `0` EADDRINUSE, and a log line proving PGlite migrate-on-boot ran (the schema_version upsert succeeds with no postgres connection).

- [ ] **Step 3: Verify config + UI scope**

Run: `curl -s localhost:4000/api/config` → `{"demo":true,"workflows":["email-inbox"]}`.
Navigate the Playwright browser to `http://localhost:5173/?dev=1`. Snapshot: ONLY the "Email inbox" tab is present (no Lead inbox / GitHub triage), and NO gmail Connect chip in the header.

- [ ] **Step 4: Run the flagship flow**

START the EMAIL SORTER → watch machine-dispatch fan out (reader/spam/important/reply children nested in the pipeline). Open a batch gate (e.g. SPAM "trash") → click approve → verify: the item reaches `finished`, the thread shows the fake success, and (DB check) `action_ledger` has a row with the demo fake result. Open the reply gate → approve → verify `draftId` starts with `demo-`.

- [ ] **Step 5: Reject + Stop**

On a fresh run, reject a gate → `finished`/`rejected`, 0 ledger row for it. Start another fan-out and use Stop workflow → ConfirmDialog → all email-inbox items `cancelled`.

- [ ] **Step 6: Report honestly**

Record which flows ran in the browser. Reserve "verified" for those. Note that this ran under `DEMO=1` (strict synthetic replay) with Postgres stopped — proving zero-credential, no-Docker operation.

- [ ] **Step 7: Restart Postgres for normal dev**

`docker compose start postgres` (leave the dev environment as found for the next sub-project).

---

## Self-Review

**Spec coverage:** B1 flag → Task 1 (+ Task 5 registration, Task 8 scripts); B2 strict replay → Task 3; B3 PGlite → Task 2; B4 effect stubs → Task 4; B5 config endpoint + scoping → Tasks 5 (server) + 6 (client); B6 synthetic cassettes + scan gate → Tasks 7 + 8; verification → Task 9. All spec sections mapped.

**Placeholder scan:** Tasks that depend on reading exact current code (Tasks 5, 6, 7, 8) say "read first" and name the precise file + what to extract, with concrete code for the parts that are determinate — these are grounded instructions, not "implement later" placeholders. The one genuine judgment point (the PGlite `Db` cast in Task 2) is called out explicitly with the recommended approach.

**Type consistency:** `isDemo()` (Task 1) used in Tasks 2, 3, 4, 5. `Db = PostgresJsDatabase<typeof schema>` (Task 2) preserved as a single type. `RecordReplayMode` gains `'demo'` (Task 3) used in `build-agent.ts` same task. `/api/config` shape `{demo, workflows}` (Task 5) matches the client `Config` type (Task 6). Effect return shapes `{ok, draftId}` / `{applied, failed, byAction}` (Task 4) match the real effects' shapes in `server.ts`.
