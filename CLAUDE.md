# AiWorkflow — Open-source framework for agent automations

Framework for AI engineers who ship agentic automations to clients:
code for the engineer, a polished UI for the client. Default focus —
inbound flows (email/leads → qualify → human approval → action).

This file is the **stable project reference** an agent reads on connect. For where we
are right now and what to build next, see **`HANDOFF.md`** (living session state).

**Where everything lives:**

- `HANDOFF.md` — current status + the next thing to build (changes every session).
- `docs/ARCHITECTURE.md` — the full vision & architecture (three modes, config-as-data,
  `defineAgent`, providers, generative UI, roadmap), each item marked BUILT / DESIGN INTENT /
  DEFERRED. **Read this first for the big picture.**
- `docs/BUILD-LOG.md` — chronological per-feature narratives of everything BUILT.
- `docs/copilotkit-notes.md` — confirmed CopilotKit v2 + AG-UI API reference.
- `.claude/skills/rules/copilotkit-v2.md` — quick-recall CopilotKit gotchas.
- `docs/CONVENTIONS.md` — code-style rules Prettier/ESLint can't enforce.
- `docs/superpowers/specs|plans/` — per-feature specs & plans.

## Agent-First Project — Continuous Learning

This is an **agent-first project**. Every correction or decision that
isn't persisted is one that will repeat.

- New pattern / preference / decision → update this file or `.claude/skills/rules/`
- Architectural decision → record it here under "Decisions"
- Status / plan changes → update `HANDOFF.md` (not here).
- These rules grow **organically** — add a rule the moment a real pattern
  appears in the code, not before.

## Conventions

All project content — docs, code, comments, identifiers, and user-facing/demo
strings — is written in English, regardless of the language used in chat.

**Code style → `docs/CONVENTIONS.md`** — the _how we write code_ rules Prettier/ESLint
can't enforce (arrow-const named-export components, `type {Name}Props`, strict
one-component-per-file, naming, import grouping), distilled from the Magma house
style and filtered to this stack. Read it before writing client code.

## Packages (`@platform/*` split — BUILT)

Yarn-classic (1.22) workspace. Quick map (full detail → `docs/BUILD-LOG.md` §5):

- `@platform/core` — isomorphic contract: `messages`, `defineAgent`, `providers` (contract),
  `handoff`. Depends on nothing concrete (just `@ag-ui/client` + `zod`).
- `@platform/providers` — isomorphic; `claude-stream`, `claude-cli-provider`, `mock-provider`.
  The `spawn` is **INJECTED**, so it stays Node-free.
- `@platform/integrations` — node-only batteries; subpath exports `./gmail-basic` +
  `./gmail-basic/format`; `googleapis` is an **optional peer** (lazy-loaded, fail-fast).
- `apps/inbox` — depends on the three by name; concrete agents in `apps/inbox/agents/`; `server/`,
  `client/`, `mcp/inbox-tools.mjs`.

**No build step** — each package's `exports` points at `./src/index.ts`; Vite/tsx/vitest
transpile workspace deps directly; typecheck = `tsc --build`. `@platform/*` is a **placeholder
scope — rename before any npm publish**. `@platform/react` + `@platform/server` are deferred
(client + server layers still live in `apps/inbox/`).

## Stack

- Client: Vite + React + TypeScript
- Server: Hono (thin BFF)
- Agent UI: CopilotKit + AG-UI (`@copilotkit/runtime` v2, `@copilotkit/react-core`) —
  confirmed API reference in `docs/copilotkit-notes.md`.
- Real now: `claude-cli` provider, Gmail MCP. Mocked/deferred: Mastra, DB, auth.

## Don't-rediscover gotchas

- **Gmail MCP:** the _official_ Google Gmail MCP (`gmailmcp.googleapis.com`) is a **Workspace
  Developer Preview** — it 403s (`caller does not have permission`) for personal `@gmail.com`
  even with everything configured. The proven community pkg `@gongrzhe/server-gmail-autoauth-mcp`
  is **archived** AND **blocked by the Claude Code safety classifier** (untrusted external code).
  → We use **our own thin stdio Gmail MCP** (`mcp/gmail-tools.mjs`) on the standard Gmail API.
- **OAuth setup is reused, not re-done:** client + token live at `~/.gmail-mcp/gcp-oauth.keys.json`
  - `credentials.json` (scope `gmail.modify`); the keys/secret are also in gitignored `.env.local`.
- never pass `--bare` to `claude` (skips keychain → "Not logged in"); auth is the **subscription**
  via macOS keychain, no API key; `core/` stays **Node-free** (Node lives in `server/` + `mcp/`);
  HITL is **client-held, two requests** (don't change client/transport — the provider conforms).
- **`<CopilotKit>` needs `agent={...}`** (see `App.tsx`): it binds internal listeners to
  `props.agent ?? 'default'`. We register `qualifier`/`reply`, NOT `'default'` — omit the prop
  and the whole tree throws _"Agent 'default' not found"_ at runtime (invisible to unit tests +
  the server `/info` probe; **only the browser catches it** → always browser-verify).
- **Per-agent tool boundary lives in `server/index.ts`** (`QUALIFIER_TOOLS`/`REPLY_TOOLS`,
  threaded via `buildAgent(def, prompts, registry, allowedTools)`). Adding/removing an MCP tool
  for an agent = edit that agent's list there (not the shared spawn). Qualifier = reader, reply
  = writer; keep them disjoint on the inbox-read tool.
- **Subagents must NOT switch git branches** to inspect history (`git checkout <sha>` /
  `git switch`): an inspection subagent did this and left the repo on `master` mid-run (work was
  safe on the branch, but confusing). Tell review/inspection agents to use `git show <sha>:path`
  / `git diff` only and verify `git rev-parse --abbrev-ref HEAD` before finishing.
- **tsx + `allowJs` + packages that ship `.ts` source:** with `allowJs:true` in
  `apps/inbox/tsconfig.json`, tsx rewrote `node_modules/fast-json-patch/index.js` to its sibling
  `index.ts` (the package ships both), which `require()`s an unshipped `./src/core` → server
  **crashed at boot** with `MODULE_NOT_FOUND`. Fix: do NOT set `allowJs` in `apps/inbox/tsconfig.json`;
  keep `.mjs` runtime files out of the TS `include`. (Invisible to unit tests + `/info` probe —
  only running the app catches it → always browser-verify.)
- **yarn-classic does not auto-install peer deps** (npm did): `@testing-library/dom` had to be
  added explicitly to root devDeps to keep the React tests green.
- **Per-package `outDir`/`tsBuildInfoFile`:** under `tsc --build`, the base's relative `outDir`
  made two packages collide on `dist-types/index.d.ts` (TS5055). `@platform/providers` +
  `@platform/integrations` set a package-local `outDir`+`tsBuildInfoFile`; `@platform/core` relies
  on the base and "owns" the root dist-types (a known minor asymmetry — do NOT fix now).
- **vitest from the app dir** needs `-c ../../vitest.config.ts` (its `test` script has this) —
  vitest stops at `apps/inbox/vite.config.ts` (no test block) and won't walk up. Root `yarn test`
  is the canonical path.
- Run from the **repo root** with yarn: `yarn dev`, `yarn test`, `yarn typecheck`, `yarn lint`,
  `yarn build`, `yarn format` / `yarn format:check`. (`yarn install` may need `--ignore-engines`
  on Node 20.14 because `@eslint/js@10` wants 20.19+.)

## Decisions

- Server = Hono (Web-Standards / fetch; mounts CopilotKit endpoint without adapters). Swappable behind a thin layer.
- Slice verified by manual click-through; TDD + review loop starts with the reusable core layer.
- Config split (later): structure in files, manager-editable text fields in DB; secrets in env only.
- Models accessed via a separate provider registry (CLI / API); agents reference a provider by name.
- First real provider = **`claude-cli`** (subprocess), not `claude-api` (no API key; binary uses the Claude Code subscription). HITL = **detect the approval tool call in the stream-json and kill the process** (we do NOT hold the CLI open awaiting a human — that would fight CopilotKit's client-held two-request pause). Resume = **stateless re-prime** (fresh run, "human approved"), no server-side session. The runtime **registry lives in `server/`** (not `core/`) because the real provider needs Node and `core/` is imported by the client; the injected `spawn` keeps the provider Node-free. Custom tools are exposed to the CLI via a **stdio MCP server**; tool names arrive prefixed `mcp__inbox__…` and are stripped to the bare names the client registered.
- Core layer is the **`@platform/core`** package (shared by client+server, no React/Node imports). The split happened once the 2nd-consumer precondition was met. `@platform/react`/`@platform/server` remain deferred.
- Message layer reuses `@ag-ui` types IN FULL (import `Message`/`ToolCall` from `@ag-ui/client`; derive per-role types via `Extract<Message,{role}>` — `@ag-ui/client` doesn't export `AssistantMessage`/`ToolMessage` by name). We add behavior (pure functions), not a parallel domain model. Approval tool names are a PARAMETER (from `def.approvals`), never hardcoded.
- `defineAgent.renders` is keyed BY TOOL NAME (`{ renderLead: "LeadCard", saveDraft: "ApprovalDialog" }`); values are component _names_; the client `renderRegistry` maps name→React component (keeps `core/` React-free).
- `defineAgent` validates STRUCTURE only (`approvals ⊆ tools`, `renders` keys ⊆ `tools`). Provider-existence is enforced by `registry.resolve(def.provider)` at wiring time. `defineAgent(def)` param is typed as `AgentDefinition` (compile-time field checks); switch to `unknown` + `.strict()` when config is loaded from file/DB (deferred). zod v3 API.
- **Tooling: Prettier + ESLint, Magma house style.** Prettier: `semi:false`, single quotes, `trailingComma:"es5"`, `printWidth:100`. ESLint flat config; `eslint-config-prettier` last (ESLint owns CORRECTNESS, Prettier owns FORMATTING). `any` allowed in `**/*.test.*`; `console` in `server/**`. **Lint stays green** — findings fixed or justified with a scoped `eslint-disable` + comment.
- **`useAgentStatus` re-syncs messages on `agent` change in the RENDER PHASE** (prev-agent `useRef` guard + `setMessages`), NOT in an effect — `agent.messages` is mutated IN PLACE by CopilotKit core (`splice`), so `useSyncExternalStore` over `() => agent.messages` would miss updates. The render-phase reset is the React "adjust state on prop change" pattern.
- AgentCard status is a **string literal union, deliberately NOT a TS `enum`** (zero runtime cost, value IS the wire string, `Record<Status,…>` exhaustiveness). Single source of truth: `client/src/status.ts` — `STATUSES` (`as const`) → `Status` → `Lifecycle` (`Exclude<Status,"awaiting_approval">`). Client-only (server/provider never reference status). `STATUS_LABEL` lives here too.

## Commands

Run from the **repo root** with `yarn` (yarn-classic 1.22 workspace):

- `yarn dev` — server (tsx watch, :4000) + client (vite, :5173) via concurrently; `/api` proxied to :4000.
- `yarn dev:server` / `yarn dev:client` — run each half separately.
- `yarn build` — vite production build.
- `yarn typecheck` — `tsc --build` (composite project references across all packages + apps/inbox).
- `yarn test` — run vitest (unit tests) across the workspace.
- `yarn lint` — ESLint (must be GREEN; we do not leave it red).
- `yarn format` / `yarn format:check` — Prettier write / check.

(`yarn install` may need `--ignore-engines` on Node 20.14 because `@eslint/js@10` wants 20.19+.)
