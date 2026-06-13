# Platform package split — `@atizar/*` (core + providers + integrations)

> **Status:** DESIGN (approved in brainstorming 2026-06-07). Implements the headline
> goal from the handoff: extract `apps/inbox/core/` into a real package boundary now
> that the `core/` contract is validated on two agents + a handoff.
> **Scope of THIS pass:** stand up an npm/yarn **workspace** and split **three** packages
> — `@atizar/core`, `@atizar/providers`, `@atizar/integrations`. `@atizar/react`
> and `@atizar/server` are deliberately **deferred** (documented as target, not built).

## 1. Why & positioning

The durable asset is not the framework code (§Business model in `ARCHITECTURE.md`); the
point of the split is a **clear contract** a developer can target to add any number of
integrations/providers without editing the framework. `@atizar/core` is that contract:
interfaces + Zod validation + tiny pure functions that everything depends on and that
depends on nothing concrete (no provider impl, no integration, no React, no Node).

This split was gated on the project's own **"second consumer" rule**: `core/` was not
extracted until two agents (qualifier + reply) and a handoff exercised it. That precondition
is met. The same gate applies to every *other* package — extract when a second consumer or a
heavy/divergent dependency appears — which is why `react`/`server`/`config`/`auth`/`db` are
not in scope.

## 2. Target architecture (vision — documented, not all built)

```
                @atizar/core   ── CONTRACT, root of the DAG, isomorphic
                  ▲   ▲   ▲   ▲      deps: zod + @ag-ui/client
      ┌───────────┘   │   │   └────────────┐   messages · defineAgent ·
@atizar/providers   │   │      @atizar/react   providers(interfaces+defineProviders) · handoff
  import {claudeCli,   │   │      (react-only: hooks, registry mechanism, shells) — DEFERRED
   mock}; heavy        │   └── @atizar/integrations ── node-only batteries pkg
   (mastra/api) =      │          ./gmail-basic (googleapis = optional peer, lazy import + fail-fast)
   subpath+optional    │          ./<next> ...
      └────────────┐   │   ┌──────┘
              @atizar/server ── node-only "door": build-agent, registry,
                       ▲          enforce allow-list, spawn glue — DEFERRED
                  apps/inbox ── SINK: concrete agents, prompts, cards, choice of entrypoints, desktop
```

**Dependency direction is the load-bearing invariant:** arrows point toward `core`. The DAG
is acyclic; no framework package may import the app.

**Runtime-environment segregation (hard constraint — breaks builds otherwise):**
- `@atizar/core` — **isomorphic** (no Node, no React). Importable by client and server.
- `@atizar/providers` — **isomorphic**; the Node `spawn` is **injected** (kept out of the package).
- `@atizar/integrations` — **node-only** (`googleapis`, MCP SDK, `fs`).
- (future) `@atizar/react` — react-only; `@atizar/server` — node-only.

## 3. Packaging strategy — one package, many entrypoints (NOT a package per plugin)

Validated against the ecosystem (LangChain JS, n8n, Vercel AI SDK):

- **Contract package is always separate** (`@langchain/core`, `ai`, `@mastra/core`). → `@atizar/core`.
- **The long tail lives in ONE batteries package with subpath entrypoints**, e.g.
  `@langchain/community` holds hundreds of integrations as subpaths; n8n holds ~400 nodes in
  `n8n-nodes-base`. → `@atizar/integrations` with `./gmail-basic`, `./<next>` …
- **Promote to its own package** (à la `@langchain/anthropic`) only when a dependency is
  heavy/divergent or the release cadence diverges. Vercel AI SDK does package-per-provider
  because each provider is a thin, light adapter.

**The governing rule:** split a package when its **dependencies diverge** (weight/conflict)
or its **release cadence diverges** — not for tidiness. Third-party extensibility comes from
the **contract** (`@atizar/core`), not from the count of first-party packages.

Two distinct mechanisms (commonly conflated):

| Mechanism | Solves | Does NOT solve |
|---|---|---|
| subpath `exports` | clean import paths, encapsulation, lazy bundling | installing transitive deps |
| `peerDependenciesMeta.optional` | npm/yarn skip auto-install; user installs only used SDKs | import paths |

Combined: one package + subpath per integration + heavy SDK as optional peer + lazy
`import()` with a fail-fast message. This lets us **defer** package-per-integration for a
long time.

## 4. Tooling & on-disk layout

- **Package manager: yarn classic 1.22** (installed). `node_modules` linker, no PnP →
  no Vite/tsx/spawn surprises. Internal deps declared as `"@atizar/core": "*"` (yarn
  classic links by name from the workspace). Lockfile becomes `yarn.lock`. Commands move
  from `npm run X` to `yarn X`.
- **No turbo/pnpm.** 3 packages + 1 app — build orchestration is overhead without payoff
  (YAGNI, consistent with the project doctrine of not over-investing in framework).
- **TS strategy: consume source `.ts` directly, no build step.** Internal packages are not
  published yet, so each `exports` points at `./src/index.ts`; Vite (client) and tsx
  (server) transpile workspace deps on the fly. A publish-time build is deferred to first
  npm publish.

```
/ (new root package.json: private, "workspaces": ["packages/*","apps/*"])
├── packages/
│   ├── core/            @atizar/core         (isomorphic)
│   ├── providers/       @atizar/providers    (isomorphic, spawn injected)
│   └── integrations/    @atizar/integrations (node-only, subpath entrypoints)
├── apps/
│   └── inbox/           "inbox" → depends on the three @atizar/* by name
├── docs/  .claude/  CLAUDE.md
```

## 5. Package contents & dependency graph

Everything below currently lives under `apps/inbox/`.

**`@atizar/core`** — isomorphic; deps `zod`, `@ag-ui/client`.
```
src/messages.ts   src/defineAgent.ts   src/handoff.ts
src/providers.ts  (Provider, PromptStrategy, ProviderFactory, defineProviders — CONTRACT ONLY)
+ their *.test.ts
exports: { ".": "./src/index.ts" }   // barrel re-exporting all four
```
`core/providers.ts` today holds only the contract (no concrete provider), so it moves whole
into core; `@atizar/providers` imports the `ProviderFactory` type from core and implements it.

**`@atizar/providers`** — isomorphic; deps `@atizar/core`, `@ag-ui/client`.
```
src/claude-stream.ts   src/claude-cli-provider.ts   src/mock-provider.ts   + *.test.ts
exports: { ".": "./src/index.ts" }   →  export { claudeCli, mock }
```
The Node spawn impl (`claude-spawn.ts`) does NOT move here — it stays in the app and is
injected, keeping the package Node-free.

**`@atizar/integrations`** — node-only; deps `@modelcontextprotocol/sdk`, `zod`;
`googleapis` = **optional peer**.
```
src/gmail-basic/index.mjs    (MCP server: get_latest_email + create_draft, draft-only)
src/gmail-basic/format.mjs   (pure helpers: parseLatestMessage, buildReplyRaw)
src/gmail-basic/format.test.ts
exports: {
  "./gmail-basic":        "./src/gmail-basic/index.mjs",
  "./gmail-basic/format": "./src/gmail-basic/format.mjs"
}
peerDependencies:     { "googleapis": "^173.0.0" }
peerDependenciesMeta: { "googleapis": { "optional": true } }
```
**`gmail-basic` is deliberately minimal** — it does exactly two things: read the most-recent
inbox email (read-only) and create a draft reply (never sends). The name signals the limited
surface; a fuller `./gmail` can be added later as a sibling subpath.

**`apps/inbox`** — sink; depends on the three `@atizar/*`.
```
stays:    server/ (incl. claude-spawn.ts), client/ (react),
          mcp/inbox-tools.mjs (the app's generative-UI tools: renderLead/saveDraft/renderVerdict),
          core/inbox.agent.ts + core/agents/*.prompts.ts (concrete agents/prompts/strategies)
changes:  imports '../../core/...'  → '@atizar/core'
          provider wiring           → '@atizar/providers'
          claude-spawn MCP path     → require.resolve('@atizar/integrations/gmail-basic')
adds:     googleapis to its own dependencies (the app USES the gmail entrypoint, so it
          installs the optional peer — the peer is exercised on a live consumer)
```
`inbox-tools.mjs` is NOT an integration — it is this app's UI-contract tool surface; it stays
in the app. `inbox.agent.ts` / `*.prompts.ts` stay in the app — concrete instances, not the
contract (N-agent mapping remains deferred to the framework phase).

**Graph (DAG, arrows → core):**
```
core  ◄── providers  ◄──┐
  ▲                     │
  └────── integrations  │   (integrations → core for types only)
  ▲                     │
  └─────────── apps/inbox ──► providers, integrations
```

## 6. Optional-peer mechanism & fail-fast (gmail-basic)

Today `gmail-tools.mjs` imports `googleapis` statically at module top → "not installed"
becomes an opaque `ERR_MODULE_NOT_FOUND` at load. Replace with a lazy resolve + actionable error:

```js
// packages/integrations/src/gmail-basic/index.mjs
async function loadGoogleapis() {
  try {
    return (await import('googleapis')).google
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error(
        "@atizar/integrations/gmail-basic requires the optional peer 'googleapis'. " +
          'Install it in your app:  yarn add googleapis'
      )
    }
    throw err
  }
}

let _gmail
async function getGmail() {
  if (_gmail) return _gmail
  const google = await loadGoogleapis()          // was: top-level `import { google } from 'googleapis'`
  const keys = JSON.parse(readFileSync(keysPath, 'utf8'))
  // …rest of the existing OAuth2 setup unchanged…
  _gmail = google.gmail({ version: 'v1', auth })
  return _gmail
}
```

Two friendly paths, both reusing the integration's existing error handling:
- **Tool invoked without `googleapis`** → `getGmail()` throws → the existing `try/catch` in
  `get_latest_email`/`create_draft` wraps it as `{ error: "…requires googleapis…" }`. The MCP
  server does not crash; the model/UI see actionable text. No new error plumbing needed —
  only the import moves inside.
- **The `format` subpath** (`@atizar/integrations/gmail-basic/format`) is pure and never
  imports `googleapis`, so `parseLatestMessage`/`buildReplyRaw` unit-test **without** the
  heavy SDK installed. That is the point of the second subpath.

Adding a second integration (e.g. slack) = a new subpath + its own optional peer, touching
neither core nor the app. This is exactly the LangChain-community model.

## 7. Migration order (incremental, green at each step)

1. **Workspace scaffold.** Root `package.json` (private, `workspaces: ["packages/*","apps/*"]`),
   convert to `yarn.lock`, `yarn install`. Nothing extracted yet — `apps/inbox` is just wrapped
   in the workspace. Verify `yarn dev`/`test`/`lint` green.
2. **Extract `@atizar/core`.** Move `messages/defineAgent/providers/handoff` + tests to
   `packages/core`; add package.json + `exports` + tsconfig. Rewrite app imports to
   `'@atizar/core'`. tsc+lint+test green. **Build the client here** (earliest point to catch
   Vite + workspace-TS resolution quirks).
3. **Extract `@atizar/providers`.** Move `claude-stream/claude-cli-provider/mock` + tests;
   depends on core. Update app/server imports. Green.
4. **Extract `@atizar/integrations`.** Move gmail into `src/gmail-basic/`; refactor to lazy
   import + subpath exports + optional peer (§6). Fix the MCP server path in `claude-spawn.ts`
   (`require.resolve('@atizar/integrations/gmail-basic')`) and the format test import. App
   adds `googleapis` to its deps. Green.
5. **Full verification.** tsc across the workspace, lint, all unit tests, then **browser E2E on
   the live Gmail account** (qualifier reads a real lead → handoff → reply draft → approve →
   real Gmail draft). No regression — this is the gate.
6. **Docs.** Update `CLAUDE.md` (commands → `yarn`, new layout, gotchas) and `ARCHITECTURE.md`
   (mark core/providers/integrations split BUILT). Record the placeholder-scope decision.

## 8. Testing

- Unit tests travel **with** their files into each package. One root `yarn test` (vitest)
  globs `packages/**` + `apps/**`. All 77 existing tests stay green.
- The pure format helpers are tested via the `…/gmail-basic/format` subpath **without**
  `googleapis` installed — this also proves the optional-peer split.
- **Browser E2E is the completion gate** (per `CLAUDE.md`: the CopilotKit agent-binding class
  of bug is invisible to unit tests and the server `/info` probe — only the browser catches it).

## 9. Risks & mitigations

- **Vite + raw TS from a workspace package** — may need `optimizeDeps.exclude` (don't pre-bundle
  the linked package) or a `resolve.alias`. → Caught early at step 2.
- **Duplicate React/CopilotKit** (two React copies → hooks crash). → `@atizar/react` is NOT
  extracted this pass; react/copilotkit remain deps only in the app, so there is a single copy.
  Low risk.
- **Launching the `.mjs` MCP server from a package** — resolve via `require.resolve(subpath)`,
  not a relative path. → Explicit at step 4.
- **yarn-classic dedupe** is weaker than npm's — but since React is untouched, the only shared
  heavy graph (`@ag-ui`, `zod`) is safe.
- **Scope rename later** — `@atizar/*` is a placeholder; renaming before first npm publish is
  a mechanical find/replace across the monorepo. Cheap, but touches many files. Accepted.

## 10. Decisions (this design)

- Split **three** packages now (core + providers + integrations); `react`/`server` deferred.
- **yarn classic 1.22** workspace; no turbo/pnpm; internal deps via `"*"`; consume TS source
  (no build step until first publish).
- Packaging = **one batteries package per axis with subpath entrypoints + optional peer deps**,
  not a package per plugin. Promote to a standalone package only on dependency-weight /
  release-cadence divergence.
- gmail integration named **`gmail-basic`** — read-latest + draft-only, name signals the
  limited surface.
- Scope **`@atizar/*`** is an explicit placeholder; rename before first npm publish.
- Node stays out of `core`/`providers` (injected `spawn`); `integrations` is node-only.
- `inbox.agent.ts`/`*.prompts.ts`/`inbox-tools.mjs` stay in the app (concrete instances /
  app UI-contract, not framework).
