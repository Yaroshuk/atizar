---
name: write-integration
description: Author a new integration module in @platform/integrations — pure injectable functions, an MCP wrapper for read tools, credentials health check, and an embedded consumer skill. Use when the user asks to add, write, or build an integration, connect an external service (Gmail, Slack, a CRM, an API), or extend an existing integration with new capabilities.
---

# Write an integration

Task skill — owns the run end-to-end: from "we need an integration that does X" to a
tested, documented module in `@platform/integrations` that agents and the server can
consume. The worked exemplar for STRUCTURE is `packages/integrations/src/gmail-viewer/`
(built by this skill's first run); `gmail-basic` is the original pattern source. The
worked exemplar for the AUTH CONTRACT is the rewritten `gmail` integration once auth
sub-stage 5 lands; until then, follow the spec
`docs/superpowers/specs/2026-06-11-integration-auth-contract-design.md` (§1 the contract,
§5 the resolver surface).

## The integration contract (FACTS — read before stage 1)

- **Pure functions, injected credential.** Every function is a plain ESM `.mjs` export that
  takes `(args, deps = {})`. The framework injects the resolved credential as
  `deps.credential` (a `ResolvedCredential` from `@platform/core`) — and/or a client built
  from it. Tests pass a fake; the server imports the function directly (no MCP child).
- **Auth is DECLARED, never self-read.** The integration exports an `auth: AuthSpec` (from
  `@platform/core`); its functions receive the live credential via `deps.credential`. The
  integration MUST NOT read `process.env` or files for secrets — resolving credentials is
  the framework's job (`resolveCredential` in `@platform/server`).
- **`AuthSpec.kind` is OPEN.** `none` / `apiKey` / `oauth2` are built-in (framework
  resolvers); a CUSTOM kind ships its OWN `CredentialResolver` (from `@platform/core`),
  registered via `registerResolver(kind, fn)` (from `@platform/server`) in USERLAND — never
  edit `@platform/core` to add an auth method (invariant I5).
- **Env naming.** Official secrets are `ATIZAR_`-prefixed and reached via `atizarEnv` (from
  `@platform/server`) — `ATIZAR_<INTEGRATION>_API_KEY` for `apiKey`;
  `ATIZAR_<PROVIDER>_CLIENT_ID` / `ATIZAR_<PROVIDER>_CLIENT_SECRET` for the `oauth2` app
  registration (e.g. `ATIZAR_GOOGLE_CLIENT_ID`). Vendor vars (e.g. `ANTHROPIC_API_KEY`,
  `DATABASE_URL`) are NOT namespaced. The integration never reads these directly — it
  declares `auth` and receives `deps.credential`.
- **`.env.example` seeding.** Every required secret gets an empty, commented line in the
  repo-root `.env.example`: a `# --- <Integration/Provider> ---` header + a `# what it is +
  where to get it` line + `ATIZAR_FOO=` (empty, no value). This skill ADDS the integration's
  block there. The per-user `oauth2` TOKEN is NOT in `.env.example` — it comes from the
  in-app Connect flow, not the env.
- **Never throw — return `{ error }`.** Callers (server effects, MCP wrappers) branch on
  `res.error`. Use a shared `errText(err)` helper for messages — reads return `ReadResult<T>`
  (`T | { error }`) from `@platform/core`.
- **Parsing is pure and separate.** Data-in/data-out helpers live in a `format.mjs` with no
  fs/env/network so they unit-test trivially.
- **Batch mutations are best-effort.** A multi-id action returns
  `{ done: string[], failed: { messageId, error }[] }` — one bad row must not abort the rest.
  A wholesale failure (client unavailable) returns `{ error }` — this shape IS the exported
  `BatchActionResult` type in `@platform/core`; import it, don't redefine it.
- **`.d.ts` beside `.mjs`** for every module a TypeScript consumer imports; the package
  `exports` map points `types` at it. The package tsconfig has `allowJs:true, checkJs:false`
  — tests in `.test.ts` import `.mjs` directly.
- **MCP wrapper exposes READ tools only.** Mutations are server-executed effects behind
  approval gates; the model NEVER sees a mutating tool (the boot-time classification kernel
  enforces this — an unclassified tool refuses to boot). The wrapper is a thin stdio
  `McpServer` whose tools delegate to the pure functions.
- **`checkCredentials()` is mandatory.** Returns the `HealthCheck` type from `@platform/core`
  (`{ ok:true; detail? } | { ok:false; error; hint }`). Health now means: does
  `resolveCredential` yield a USABLE credential for this `(integration, connection)`? A null
  (not connected) or a throw → `{ ok:false, error, hint }`, where the `hint` points the
  developer at the in-app **Connect** flow (for `oauth2`) or names the env var to set
  (`ATIZAR_<INTEGRATION>_API_KEY` for `apiKey`). The server's health surface (spec F3)
  consumes this.
- **Type the `.d.ts` against `@platform/core`** — import `HealthCheck` / `ReadResult` /
  `BatchActionResult` rather than re-declaring result shapes; add `@platform/core` to the
  package deps. The contract is types only — there is no `defineIntegration()` and no base
  class (belief #3).
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

> **AUTH INTERVIEW (mandatory). Determine the `AuthSpec`. If you cannot tell from the
> service's docs or the developer's description HOW authentication works, STOP and ask the
> developer — never guess.** Establish: the `kind`; for `oauth2`, the provider + the EXACT
> scopes (ask if unstated); for `apiKey`, the env var it reads
> (`ATIZAR_<INTEGRATION>_API_KEY`); for a custom kind, that the integration ships its OWN
> `CredentialResolver` (scaffold a stub — it registers in userland via `registerResolver`,
> NOT in core). State the exact env var name(s) out loud and confirm you will add them to
> `.env.example`.

## Stage 3 — TDD loop, one function at a time

For each function: write the failing vitest with a fake credential FIRST → run it, see it
fail for the predicted reason → implement the minimal `.mjs` → green → write the `.d.ts` if a
TS consumer will import it → commit. Functions take `deps.credential` (a `ResolvedCredential`)
and/or a client built from it — the test passes a fake. Order: pure `format.mjs` helpers
first, then reads, then mutations, then `checkCredentials`.

The scaffold also includes an **`auth` export** — an `auth.mjs` + `auth.d.ts` (or an `auth`
field) declaring the `AuthSpec` agreed in the Stage 2 interview. For a custom `kind`,
scaffold the integration's own `CredentialResolver` stub here (registered in userland via
`registerResolver`, never in core).

## Stage 4 — MCP wrapper + exports

Write the stdio `index.mjs` (READ tools only — restate per tool why mutations are absent),
add all subpath `exports` entries. **Append the integration's secret block to the repo-root
`.env.example`** — a `# --- <Integration/Provider> ---` header + a `# what it is + where to
get it` comment line + the empty `ATIZAR_*=` line(s) agreed in Stage 2 (no per-user `oauth2`
token — that comes from the in-app Connect flow). Then run
`yarn typecheck && yarn test && yarn lint`.

## Stage 5 — Embedded consumer skill

Write `packages/integrations/skills/<name>/SKILL.md` (docs/AGENTIC.md A7 — ships with the
package, versioned with the code): what the integration does, how to wire reads vs effects
into an agent, where credentials come from and how to fix each `checkCredentials` failure.
Register nothing in `.claude/skills/README.md` for this one — consumer skills live with
their package; the repo index covers dev skills.

## Stage 6 — Validate

`yarn typecheck && yarn test && yarn lint && yarn format:check`. Grep the integration for
`process.env` / file reads of secrets — there must be NONE (auth is injected via
`deps.credential`; the framework resolves it). If real credentials exist on this machine,
run a live READ-ONLY smoke (the health check + one read). NEVER live-run
mutations from this skill — that is the consuming workflow's browser-E2E job (the
`browser-verify` procedure, invoked by the workflow build, not here — this skill's output
is a library, not running-app behavior).

**Run the smoke as a temp `.mts` file INSIDE the repo, not `yarn tsx -e "…"`.** Past-run
incident (gmail-viewer, 2026-06-11): `tsx -e` failed twice — first `Top-level await is not
supported with the "cjs" output format` (the `-e` eval is CJS), then, after moving to a file
in `/tmp`, `ERR_MODULE_NOT_FOUND: Cannot find package '@platform/integrations'` (Node
resolves the workspace symlink only from within the repo tree). Both vanish with a throwaway
`./smoke.mts` at the repo root (`import {...} from '@platform/integrations/<name>/<fn>'`;
top-level `await`), run via `yarn tsx smoke.mts`, then `rm` it. Print only counts/lengths —
never real fetched content into logs.

## Stage 7 — Foundation check

Run the `check-foundation` procedure on the result (new package surface; verify no engine
import leaked into `@platform/core`, no mutation became model-visible). A conflict is a
STOP: warn the developer and get direct confirmation.

## Stage 8 — Self-improvement (last, silent skip is the default)

After commits land: did the user correct the same thing twice? Did a stage not match the
work? If nothing systemic surfaced, write one sentence ("Run went smoothly, nothing
systemic surfaced.") and exit. Otherwise propose 1–2 systemic changes to THIS skill (or to
a Procedure/Rule this run used), each quoting the motivating incident verbatim.
