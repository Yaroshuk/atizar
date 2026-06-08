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

- **GitHub is STRICTLY READ-ONLY.** The GitHub triage workflow reads the real Magma Board
  (`matteappen` Projects v2 #8) + issues via `gh`. NEVER post/comment/edit/close/label/move or
  mutate anything on GitHub — not in the `github-tools.mjs` adapter (it exposes only `gh project
item-list` / `gh issue view`), not in any agent allow-list, nowhere. REPLY-DRAFT only _drafts_ a
  suggested comment as generative UI; nothing is posted. The model also has no Bash (deny-list), so
  the adapter is the only GitHub path. This is a hard user rule. The board/owner/assignee are env
  knobs (`GH_PROJECT=8`, `GH_OWNER=matteappen`, `GH_ASSIGNEE=Yaroshuk` — defaults in
  `github-tools.mjs`, overridable via the shell env `claude-spawn.ts` passes through).
- **MCP tool RESULTS are surfaced into the stream (`TOOL_CALL_RESULT`).** The `claude` CLI runs MCP
  tools internally and feeds results back as a top-level `{type:'user', message:{content:[{type:
'tool_result', tool_use_id, content}]}}` line. `claude-stream.ts` now emits an AG-UI
  `TOOL_CALL_RESULT` (→ a `role:'tool'` ToolMessage paired by id) **only for tools we surfaced**
  (`emittedToolIds`), so internal tool results (ToolSearch) stay hidden. This is the UNIFIED fix for
  two old symptoms: (1) the default tool chip stuck on "Running" forever (it waits on a `toolMessage`
  that never arrived) now flips to Done; (2) a data tool's output reaches the client directly, so the
  model needn't re-emit it into a render tool. Cards read a data tool's result via
  `ThreadResultsContext` (`AgentModal` parses each result by tool name; `useThreadResult(name)`).
- **Contiguous text deltas MUST share ONE `messageId`.** AG-UI `TEXT_MESSAGE_CHUNK` closes the open
  message and starts a new one whenever a chunk's `messageId` differs — so a fresh `randomUUID()` per
  delta renders one bubble PER delta (the "Draf"/"ted a reply" split). `claude-stream` allocates the
  id lazily and clears it only at a real boundary (tool call, `message_start`, end of a complete
  message). Invisible to typecheck; the unit tests assert shared-id + reset-after-tool — but the
  split itself **only the browser shows** → browser-verify text rendering.
- **The agent thread is a CONSUMER surface — only cards show by default.** `AgentModal` renders a
  tool call only if its name is a registered render/HITL tool (`renderableToolNames` from the specs);
  internal data-fetch tools (`list_my_tickets`, `get_latest_email`, `get_ticket`) are hidden. **Dev
  mode** (`?dev=1`, persisted to localStorage via `devMode.ts`) reveals every raw tool-call chip for
  debugging. Adding a new card → register its render spec (so it surfaces); a pure data tool stays
  hidden by design.
- **Generative-UI render closures are captured ONCE.** `useRenderTool`'s effect deps stringify a
  function to `"[null]"`, so the render callback you pass is frozen on first registration. Any
  callback it closes over (e.g. the handoff trigger) MUST be a stable `useCallback` that reads
  changing state via a `useRef` mirror — a state-dependent callback freezes its initial snapshot and
  silently no-ops. Invisible to typecheck + unit tests → **only the browser catches it**.
- **Kill stale dev servers before browser-verifying.** A `yarn dev` from a previous session can keep
  running and squat `:4000`/`:5173`; a fresh `yarn dev` then hits `EADDRINUSE` and crashes while the
  OLD server keeps answering `curl` with **stale pre-branch code** (silently misleading). Before
  driving the browser: `pkill -9 -f "apps/inbox/node_modules/.bin/(tsx|vite|concurrently)"`, free the
  ports (`lsof -tiTCP:4000,:5173 | xargs kill -9`), then confirm the boot log shows
  `server on http://localhost:4000` from THIS run (no `EADDRINUSE`).
- **GitHub access is GraphQL-budgeted.** Projects v2 reads AND `gh search` go through the GraphQL API
  (5000 points/hr, shared across all gh callers). A `gh project item-list` over the full board is
  point-heavy; that's why `list_my_tickets` uses a single scoped `search` query instead. On
  `API rate limit already exceeded`, diagnose with `gh api rate_limit --jq .resources.graphql`
  (rate_limit is REST — free to poll) and wait for `.reset`. Granting `read:project`/`project` needs
  `gh auth refresh -s read:project,project --hostname github.com` run in a **real terminal** (the
  device-code flow needs a TTY; the `!`-prefix shell can't do it).

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
- **Workflows are modules; agents are registered by INSTANCE id.** (As of `feat/workflow-separation`,
  §8.) A workflow = `apps/inbox/workflows/<id>/{descriptor,server,client}` + one line per aggregator
  (`workflows/index.ts`, `server/workflows.ts`, `client/src/workflows.ts`) — agent defs live in the
  descriptors, NOT `apps/inbox/agents/` (the flat `inbox.agent.ts`/`github.agent.ts` are gone). The
  server registers every workflow×agent under `instanceId(wf, agent)` = `wf__agent`, and the client
  `useAgent` uses that id, so the same agent in two workflows = two independent runs (the per-agent
  `/threads` 405 probes show these instance ids). ALL workflows' agents mount idle for the session
  (not just the active one) so a cross-workflow target is always ready. Cross-workflow delivery goes
  ONLY through a workflow's published `inputs` contract (`{name, schema, agentId}`), never a foreign
  agent id; `deliver` runs the target in the BACKGROUND — no auto-open, no auto-switch (badge + an
  "Open in <wf>" button instead). Handoff-emitting render tools carry an `origin` param (injected by
  the per-instance prompt) so one shared render registration routes to the right copy.
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
