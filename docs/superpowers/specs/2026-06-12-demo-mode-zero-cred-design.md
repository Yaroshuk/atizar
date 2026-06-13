# Design — Zero-credential `DEMO=1` mode (sub-project B of 7c)

**Date:** 2026-06-12 · **Branch:** `feat/7c-packaging` · **Status:** approved, pre-plan

## Goal

A newcomer can `git clone … && yarn install && DEMO=1 yarn dev` and, with **zero credentials and
no Docker**, immediately drive the flagship **email-inbox** workflow end-to-end in the browser:
START the sorter → watch it machine-dispatch reader/spam/important/reply children → open a batch
gate → approve → see the action "executed" and the item finish; reject and Stop also work. This is
the public "10-minute demo" and the living proof of the framework's belief #3 (userland consumes
only the public packages).

## Scope

- **In:** a single server env flag `DEMO=1` that switches provider, DB, effects, and workflow
  registration; a strict synthetic-cassette replay path; PGlite (in-memory); demo effect stubs; a
  `GET /api/config` endpoint + client tab filtering; authored synthetic cassettes for email-inbox;
  a `scanCassette` CI gate over the committed demo cassettes.
- **Out (non-goals):** lead-inbox and github-triage in demo (hidden — email-inbox is the
  showcase, by the user's call); real OAuth/Connect in demo; the bearer token (sub-project C);
  README/LICENSE (sub-project F); the `@atizar/*` scope rename (sub-project E). PGlite as a
  production option (DEMO-only).

## Decisions (resolved during brainstorming — do not re-litigate)

1. **Showcase = email-inbox only.** Demo hides lead-inbox + github-triage tabs.
2. **Approve effects = fake-success.** The demo effect stub returns `{ok:true, …}` (e.g.
   `draftId:'demo-<n>'`), the item finishes, the ledger records the fake result — nothing real
   happens, but the full approve→executed→finished path renders.
3. **Mechanism = synthetic cassettes + forced strict replay** (reuses the record/replay layer),
   NOT an extended hand-written mock provider.
4. **PGlite in-memory** (ephemeral; resets each boot → always-clean demo board).
5. **Tab filtering via `GET /api/config`** (the server owns DEMO; single source of truth), not a
   separate client `VITE_DEMO` build flag.

## Components

### B1 — `DEMO` flag plumbing

`DEMO=1` is read via a single standalone helper `isDemo()` exported from `@atizar/server`
`env.ts` — NOT on `atizarEnv` (that object is the documented "ONE place ATIZAR_* vars are read";
`DEMO` is an unprefixed dev/demo tooling flag, the same class as `DEV_RECORD_REPLAY`, so it stays
unprefixed). Both the server package's DB layer and the app's registration/wiring import `isDemo()`
as the single source of truth. It gates B2–B5. The
demo is launched with a single command; add a `demo` script (`DEMO=1 yarn dev`) so the flag reaches
**both** halves — the client learns DEMO from `GET /api/config`, so only the server process needs
the env var. `predev` still frees ports; PGlite needs no Postgres container, so the demo path must
**skip** `ensure-postgres.sh` (guard it on `DEMO`).

### B2 — Provider: forced strict synthetic replay

- A new replay mode distinct from the existing three (`unset` / `record` / `1|replay`). Proposed:
  `DEMO=1` implies **strict replay** — `withRecordReplay` reads cassettes but a missing cassette
  throws a clear `DemoCassetteMissing` error (NEVER falls through to a real claude/Mastra call;
  there is no binary/key in demo). Implement as an explicit mode passed into the decorator, derived
  from `DEMO` at `build-agent.ts`, rather than overloading `DEV_RECORD_REPLAY`.
- **Cassette source split:** real recordings stay in the gitignored `apps/inbox/.cassettes/`;
  synthetic demo cassettes live in a **committed** `apps/inbox/demo-cassettes/`. In demo mode the
  `CassetteStore` reads from `demo-cassettes/`. (Implementation: the store's base dir becomes a
  parameter selected by mode.)
- The sorter's synthetic cassette emits a fixed sort decision (`reader:N, spam:N, important:N,
  reply:N`) → deterministic machine-dispatch. Child cassettes (`reader`/`spam`/`important`/`reply`)
  exist for exactly the agents the sorter dispatches.

### B3 — DB: PGlite (in-memory)

- `@atizar/server` DB client (`db/client.ts`) selects the driver by mode: real Postgres via
  `drizzle-orm/postgres-js` (default) vs **PGlite** via `drizzle-orm/pglite` (`@electric-sql/pglite`,
  in-memory `new PGlite()`), chosen when `DEMO` is set (or a `pglite`/memory `DATABASE_URL`).
- `db/migrate.ts` selects the matching migrator (`drizzle-orm/pglite/migrator` for PGlite). Same
  Postgres dialect → the existing `db/migrations/` SQL runs unchanged. Migrate-on-boot runs against
  the fresh in-memory DB.
- The startup sweep + all StateStore CRUD are dialect-agnostic (plain drizzle) → unchanged.
- `@electric-sql/pglite` is an **optional dependency** (only demo needs it), lazy-loaded with a
  fail-fast actionable error (the optional-peer pattern already used for `googleapis`).

### B4 — Effects: demo fake-success stubs

- In demo, the email-inbox ServerBinding effects (the functions behind `saveDraft`/`trash`/
  `markRead`/`star` — see `apps/inbox/workflows/email-inbox/{server,apply-actions}.ts`) are
  replaced by stubs returning a believable success shape (`{ok:true, draftId:'demo-<seq>'}` for
  draft; `{ok:true}` for batch actions). No `resolveCredential`, no `googleapis`.
- Wiring: the workflow's `server.ts` builds its effects from a small factory that returns real vs
  demo implementations based on the mode (passed in at registration), so the demo swap is one
  branch, not scattered conditionals. Boot-time effect-binding exhaustiveness checks
  (`agent-checks.ts`) still pass (same effect keys, different bodies).

### B5 — Workflow scoping + `GET /api/config`

- New read endpoint `GET /api/config` → `{ demo: boolean, workflows: string[] }` where `workflows`
  is the enabled workflow ids (in demo: `['email-inbox']`; otherwise all registered).
- Server side: in demo, register only the email-inbox workflow's agents (the server's workflow
  registration loop filters by the demo-enabled set), so health/board only ever reference
  email-inbox `wf__agent` ids.
- Client side: `WorkflowBoard` (or a thin wrapper in the demo app) fetches `/api/config` on mount
  and filters `workflowsConfig.workflows` to the reported set before rendering tabs; in demo the
  Connect chip is hidden (no integration to connect). Non-demo behavior is unchanged (all
  workflows, chip shown). A brief load state before config resolves is acceptable.

### B6 — Synthetic cassettes + `scanCassette` CI gate

- Author `apps/inbox/demo-cassettes/email-inbox__{sorter,reader,spam,important,reply}.jsonl` by
  hand (or by recording once against a throwaway synthetic inbox and then scrubbing — but authoring
  fresh is safer and is the rule: **never scrub real recordings into demo data**). Invented
  identities only: a spam promo, an important client note, an informational newsletter, and one
  email needing a reply — a believable small inbox. The JSONL format matches the existing cassette
  schema (`{step, event}` per line).
- A CI step runs `scanCassette` (exported from `record-replay.ts`) over every file in
  `demo-cassettes/` and fails the build on any hit (emails/phones/secrets patterns). Names/postal
  addresses are not regex-detectable — the synthetic-authoring discipline + human review cover
  those. Add this as a script (`yarn demo:scan-cassettes`) wired into CI.

## Data flow (demo run)

`DEMO=1 yarn dev` → server boots: PGlite in-memory migrated, only email-inbox agents registered,
effects = demo stubs, provider = strict replay over `demo-cassettes/`. Client mounts → `GET
/api/config` → renders only the Email inbox tab, no Connect chip. Operator clicks START sorter →
strict-replay yields the sorter's synthetic events → machine-dispatch fans out children →
child cassettes replay → batch/reply gates open → operator approves → demo effect stub returns
fake success → ledger records it → `resume()` replays the closing narration → item finished.

## Testing / verification

- **Unit:** demo provider-mode selection (strict replay throws on missing cassette, never calls the
  underlying provider); PGlite client construction + migrate-on-boot creates the schema; demo
  effect stubs return the fake shapes and the boot-time exhaustiveness check still passes;
  `/api/config` returns the demo-filtered workflow set; `scanCassette` over the authored demo
  cassettes finds nothing.
- **Browser E2E (the headline, DEMO=1, no Docker, no creds):** only Email inbox tab visible, no
  Connect chip; START sorter → machine-dispatch fan-out (reader/spam/important/reply children
  nested in the pipeline); open a batch gate → approve → fake success → item finished, ledger row;
  reject → finished/rejected; Stop workflow/all on the live fan-out. Confirm a stale Postgres
  container is NOT required (stop it first to prove independence).

## File touch points (for the plan)

- `packages/@atizar/server`: `db/client.ts`, `db/migrate.ts` (driver/migrator selection), `env.ts`
  (`demo()` helper), new `GET /api/config` in `routes.ts`, package `@electric-sql/pglite` optional dep.
- `apps/inbox/server`: `build-agent.ts` (strict-replay mode), `record-replay.ts` (cassette base-dir
  param + strict mode + `DemoCassetteMissing`), `providers.ts`/`index.ts` (demo wiring + filtered
  registration + skip `ensure-postgres`), `package.json` (`demo` + `demo:scan-cassettes` scripts).
- `apps/inbox/workflows/email-inbox`: `server.ts`/`apply-actions.ts` (real-vs-demo effect factory).
- `apps/inbox/client`: fetch `/api/config`, filter tabs, hide Connect chip in demo.
- New: `apps/inbox/demo-cassettes/email-inbox__*.jsonl` (committed, synthetic).
- CI config: run `yarn demo:scan-cassettes`.

## Risks / notes

- Keeping demo cassettes deterministic with the sorter's machine-dispatch: the sorter cassette must
  reference child email ids that the child cassettes also use; author them as one coherent set.
- The client load-before-config flash: keep it minimal (skeleton/empty board), acceptable for demo.
- PGlite in-memory means board state is lost on server restart — intended (fresh demo each boot).
