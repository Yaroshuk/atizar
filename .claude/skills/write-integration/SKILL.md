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
