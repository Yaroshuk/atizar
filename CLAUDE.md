# AiWorkflow — Open-source framework for agent automations

Framework for AI engineers who ship agentic automations to clients:
code for the engineer, a polished UI for the client. Default focus —
inbound flows (email/leads → qualify → human approval → action).

📐 **Read `docs/ARCHITECTURE.md` first** — the full vision & architecture
(three modes, config-as-data, `defineAgent`, providers, generative UI, roadmap),
with each item marked BUILT / DESIGN INTENT / DEFERRED. This file is the
operational index; that file is the big picture.

## ⏭️ Handoff — start here (next session)

**On `feat/consumer-desktop-reskin` now (BUILT, browser-verified):** **the consumer desktop
re-skin** — the Smedja design system (exported from Claude Design; bundle decoded from the
`api.anthropic.com/v1/design/...` gzip→tar) is applied to `apps/inbox/client`. The flat two-card
view is now a **two-panel desktop**: a left **Pipeline** column + a right **Your agents** grid,
each under the SAME thin `.comp-head` (icon + title). Tokens (`#f5f5f7`/`#fff`/teal `#0a7`/amber,
radii, soft shadows, system-ui) live in `client/src/styles.css`; the 5 components (`AgentCard`,
`AgentModal`, `LeadCard`, `VerdictCard`, `ApprovalDialog`) were re-skinned (markup+classes only,
CopilotKit/AG-UI logic untouched). New: `components/Icon.tsx` (one component + `Record<IconName,
paths>` line icons), `components/PipelineColumn.tsx` + pure `pipeline.ts` (`activePipeline`:
**shows only launched agents — status ≠ idle — ordered source-before-target by `def.handoffs`,
tinted green/amber/red, connected by a ↓**). `status.ts` gained `STATUS_LABEL`. Per-agent
subtitle+icon are passed client-side from `InboxView` (core `defineAgent` passport left untouched
— a `subtitle`/`icon` field is deferred). **DROPPED by the user** (in the design but not wanted):
left icon rail/sidebar, global top bar, Manager/Admin, account, notifications, admin settings,
Leads table, run history. Browser-verified E2E on real Gmail just now (qualifier → verdict
sales/hot → handoff → reply draft → amber approval → real Gmail draft id returned; pipeline lit
qualifier-green then reply-amber with the connector). 84 unit tests (+5 `pipeline`), tsc+lint+
format+build green. Spec: `docs/superpowers/specs/2026-06-07-consumer-desktop-reskin-design.md`.
Design bundle (reference, gitignored under /tmp): chats + `Consumer Desktop v2.html` + `styles.css`
also carry a richer v2/v3 (Lead Manager fan-out, multi-lead triage, dispatch card) we did NOT build.

**Previously on `feat/platform-package-split` (BUILT, browser-verified):** **the `@platform/*` package
split** — the library is extracted into a **yarn-classic (1.22) workspace**. `core` +
`providers` + `integrations` are now real packages (`@platform/core`, `@platform/providers`,
`@platform/integrations`) consumed by `apps/inbox` by name; the contract is validated. Internal
packages are consumed as **raw TS source** (no build step — Vite/tsx/vitest transpile workspace
deps directly; typecheck = `tsc --build` composite project references). Commands now run from the
**repo root** with `yarn`. **Browser-verified end-to-end on real Gmail just now:** qualifier read
a real "Order: 10 units — delivery question" → sales/hot → handoff → reply drafted from the
payload (no inbox re-read) → approved → real Gmail draft (draft+thread id returned, not sent). 79
unit tests, tsc+lint+format:check+build green. See the "Packages" section below.

**Previously on `master` (MERGED, `56f07d0`):** **two agents + manual handoff + strict single
entry point** — the "second consumer" that validated the `core/` contract (the precondition for
the split). A **LEAD QUALIFIER** (the **only** inbox reader: `get_latest_email` → `renderVerdict` →
VerdictCard) sits beside the **REPLY AGENT** (a writer: `renderLead`/`saveDraft`/`create_draft`,
**no inbox access**) on a two-card desktop. Manager clicks **"Draft reply"** on the verdict →
**handoff**: reply runs **seeded with the verdict** (no inbox re-read) → `saveDraft` → approve
→ real Gmail draft. Handoff _mechanism_ is in **`@platform/core` (`handoff.ts`)** (`encode/decodeHandoff`,
pure) so a future agent/server trigger reuses it; only the human _trigger_ is client-side. The
boundary is **hard** (per-agent MCP allow-list in `server/index.ts` → `buildAgent(...,
allowedTools)` → spawn), not prompt-only. Provider seam = per-agent `PromptStrategy` factories
(`ProviderFactory`) — **Mastra-ready**. See the "Two agents + manual handoff" section below +
`docs/superpowers/specs|plans/2026-06-07-two-agents-handoff*`. (Also on `master`: the prior
**Gmail draft agent**, `feat/gmail-draft-integration` @ `de8f7f4`, + the `claude-cli` provider.)

**Pick next (suggested order) — the library split (core+providers+integrations) is DONE:**

1. **Finish the split — `@platform/react` + `@platform/server` extraction (deferred):** the
   client React layer (`renderRegistry`, `actions`, hooks, `AgentModal`) and the Hono/BFF +
   spawn server layer still live in `apps/inbox/`. Extract them into packages when the app/
   framework boundary there settles (don't over-invest early). The `@platform/*` scope is a
   **placeholder** — rename before any npm publish.
2. **Multi-provider / Mastra** (can interleave): add a `mastra` (or `claude-api`) factory beside
   `claude-cli` behind the existing `Provider` seam in `@platform/providers`. The seam is already a
   lowest-common-denominator (history-in → AG-UI-events-out; pause = stop; resume = new run) — no
   seam change needed. Needs an API key. See the Mastra-coexistence rules in the two-agents spec.
3. _Polish (cosmetic, deferred):_ the model still narrates a bit ("I'll load the tool schemas…")
   AND the qualifier/reply verdict prints as plain markdown paragraphs in the modal alongside
   the card — strip pre-tool / duplicate chatter client-side or via prompt. Tighten Gmail scope
   `gmail.modify`→`readonly`+`compose`.

**Don't-rediscover gotchas:**

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

## Agent-First Project — Continuous Learning

This is an **agent-first project**. Every correction or decision that
isn't persisted is one that will repeat.

- New pattern / preference / decision → update this file or `.claude/skills/rules/`
- Architectural decision → record it here under "Decisions"
- These rules grow **organically** — add a rule the moment a real pattern
  appears in the code, not before.

## Conventions

All project content — docs, code, comments, identifiers, and user-facing/demo
strings — is written in English, regardless of the language used in chat.

**Code style → `docs/CONVENTIONS.md`** — the _how we write code_ rules Prettier/ESLint
can't enforce (arrow-const named-export components, `type {Name}Props`, strict
one-component-per-file, naming, import grouping), distilled from the Magma house
style and filtered to this stack. Read it before writing client code.

## Skills / Rules

Hard-won API gotchas are distilled into rule files for quick recall:

- `.claude/skills/rules/copilotkit-v2.md` — CopilotKit v2 + AG-UI must-not-rediscover rules

## Packages (`@platform/*` split — BUILT)

The library is extracted into a **yarn-classic (1.22) workspace** (`feat/platform-package-split`,
browser-verified). Layout:

```
/ (root package.json: private, "workspaces":["packages/*","apps/*"], shared dev tooling + scripts)
  tsconfig.base.json (shared compiler opts: composite, emitDeclarationOnly, moduleResolution bundler)
  tsconfig.json (solution: references all packages + apps/inbox)
  vitest.config.ts, eslint.config.js, .prettierrc, .prettierignore  (all at ROOT now)
packages/
  core/         @platform/core         (isomorphic: messages, defineAgent, providers[contract], handoff) deps: @ag-ui/client, zod
  providers/    @platform/providers    (isomorphic; claude-stream, claude-cli-provider, mock-provider; spawn INJECTED) deps: @platform/core, @ag-ui/client
  integrations/ @platform/integrations (node-only batteries) subpath exports: "./gmail-basic" + "./gmail-basic/format"; deps @modelcontextprotocol/sdk + zod; googleapis = OPTIONAL peer
apps/inbox/     "inbox" — depends on the three @platform/* by name ("*"); concrete agents in apps/inbox/agents/; server/, client/, mcp/inbox-tools.mjs
```

- **Dependency direction:** everything depends on `@platform/core`; **core depends on nothing
  concrete** (just `@ag-ui/client` + `zod`). `@platform/providers` is **isomorphic** (the
  `spawn` is INJECTED, so it stays Node-free). `@platform/integrations` is **node-only batteries**
  with **subpath exports** (`./gmail-basic`, `./gmail-basic/format`) + **optional peer deps**
  (`googleapis` is loaded lazily inside the MCP server via `optional-peer.mjs` → `optionalPeerError`,
  fail-fast; the app installs it because it uses the entrypoint).
- **No build step — consume raw TS source:** each package's `exports` points at `./src/index.ts`;
  Vite + tsx + vitest transpile workspace deps directly. Typecheck = `tsc --build` (composite
  project references).
- `apps/inbox/server/claude-spawn.ts` resolves the gmail MCP server via
  `require.resolve('@platform/integrations/gmail-basic')` (createRequire), not a relative path. The
  app's OWN generative-UI tools `mcp/inbox-tools.mjs` stayed in the app (contract, not integration).
- The contract (`@platform/core`) is what enables third-party extension. **`@platform/*` is a
  placeholder scope — rename before any npm publish.** `@platform/react` + `@platform/server` are
  deferred (client + server layers still live in `apps/inbox/`).

## Current State

**COMPLETE — browser-verified.** The vertical slice loop works AND the reusable
core layer is extracted into `@platform/core` (was `apps/inbox/core/`):

- `@platform/core` (`messages.ts`) — typed message layer over `@ag-ui` (`hasPendingApproval`,
  `approvalResolved`, `pairToolResults`, guards). Replaces the `toolCallId↔toolMessage`
  logic that was duplicated in 3 files; no more `any`.
- `@platform/core` (`providers.ts` contract) + `@platform/providers` (`mock-provider.ts`) —
  `Provider` interface (`run(input) → AsyncIterable<BaseEvent>`) + `defineProviders` registry +
  one fake provider that emits the scripted inbox stream.
- `@platform/core` (`defineAgent.ts`) + `apps/inbox/agents/` — the Zod-validated agent passport +
  the concrete inbox instances (`replyAgent`/`qualifierAgent`, registries).
- Threaded through both sides: server (`apps/inbox/server/build-agent.ts`) builds the
  `BuiltInAgent` from the passport + registry; client (`apps/inbox/client/src/renderRegistry.tsx`,
  `actions.tsx`, `useAgentStatus.ts`, `AgentModal.tsx`, `App.tsx`) reads the passport.
  The hardcoded `"confirmSend"`/`"renderLead"`/`"LeadCard"` strings are gone.

Behavior is identical to the slice (closed card Idle → Working → Awaiting approval →
Done; modal thread = assistant text + LeadCard + ApprovalDialog; approve → resume →
"Done — reply sent."). 28 unit tests pass; browser click-through re-verified. See:

- Slice: `docs/superpowers/specs/2026-06-06-inbox-vertical-slice-design.md` (+ plan)
- Core layer: `docs/superpowers/specs/2026-06-06-core-layer-design.md`
  - `docs/superpowers/plans/2026-06-06-core-layer.md`

## First real provider — `claude-cli` (BUILT on branch `feat/claude-cli-provider`)

The first real provider is built: it runs the **real `claude` CLI as a subprocess**
behind the `Provider` seam (we chose `claude-cli` over `claude-api` — no API key; the
binary uses the Claude Code subscription login). Files (`apps/inbox`):

- `core/claude-stream.ts` — pure NDJSON→AG-UI parser (isomorphic). Handles BOTH
  streamed `stream_event` deltas and complete top-level `assistant` messages (deduped),
  strips the `mcp__inbox__` tool prefix, surfaces `result` errors as text, and STOPS
  after the approval tool call (HITL pause). Skips `<synthetic>` message text.
- `core/claude-cli-provider.ts` — `Provider` factory with an **injected** `spawn`
  (keeps `core/` Node-free). Turn 1 = canned-lead prompt → stream → stop at `confirmSend`,
  kill. Resume (approval resolved) = **stateless re-prime** (fresh run, "human approved").
- `server/claude-spawn.ts` — the real Node spawn (`claude -p … --mcp-config …
--output-format stream-json`), 120s timeout, spawn-error/timeout surfaced as a result
  line, temp config dir cleaned up, `ANTHROPIC_API_KEY` deleted (force subscription auth).
  **Do NOT pass `--bare`** — it skips keychain reads, so the subscription OAuth token
  (stored in the macOS keychain) isn't found → every run returns "Not logged in".
- `mcp/inbox-tools.mjs` — stdio MCP server exposing `renderLead`/`confirmSend` so the
  model can call them (handlers are trivial acks; the UI is driven by emitted AG-UI events).
- `server/providers.ts` — runtime registry (`mock` + `claude-cli`), **server-side** (the
  registry moved out of `core/inbox.agent.ts` because the real provider needs Node and
  `core/` is imported by the client). `inboxAgent.provider` is now `'claude-cli'`.

**Verification:** 41 unit tests pass; lint+tsc clean. **The full real-model happy path is
browser-verified end-to-end**: START → real `claude` reads the canned lead → drafts a
contextual reply → calls `renderLead` (→ LeadCard) + `confirmSend` (→ ApprovalDialog) →
pause (Awaiting approval) → approve → resume → real "Done — your reply … has been sent."
Spec/plan: `docs/superpowers/specs/2026-06-06-first-real-provider-design.md` +
`docs/superpowers/plans/2026-06-06-first-real-provider.md`.

**Loader:** while a run is active (`status === 'running'`) the card swaps its status dot
for a spinner and the modal shows a trailing "Working…" — real runs take seconds.

**TODO — later, play with prompts/restrictions (not blocking):**

- The model reaches the MCP tools via a built-in `ToolSearch` step. We already filter
  non-contract tool calls out of the thread (`surfaceTools` in `claude-stream.ts`), so the
  "ToolSearch Running" chip no longer shows — but the model still _uses_ ToolSearch and
  sometimes narrates it. Do NOT hard-disallow `ToolSearch` (that's how it finds the tools
  here); instead tighten the available-tool set / permission config so it goes straight to
  the tools.
- The model still narrates a bit ("I'll load the inbox tool schemas, then surface the lead")
  despite the anti-narration line in `firstPrompt`. Tune the prompt (or strip pre-tool
  chatter client-side) so the consumer thread stays clean.

## Gmail draft integration — BUILT (branch `feat/gmail-draft-integration`)

The first real integration. The inbox agent reads your **latest real Gmail email** and,
on one human click, saves a **draft reply** in Gmail (variant B — never sends; the human
sends from Gmail). Browser-verified end-to-end on a real account. Files (`apps/inbox`):

- `mcp/gmail-format.mjs` — **pure** helpers (unit-tested): `parseLatestMessage` (Gmail full
  message → `{threadId, from, subject, body}`, base64url decode + text/plain walk) and
  `buildReplyRaw` (RFC822 reply MIME, `Re:`-no-double-prefix, base64url).
- `mcp/gmail-tools.mjs` — our **own thin stdio Gmail MCP** on the standard `googleapis`
  Gmail API. Tools: `get_latest_email` (no args) + `create_draft {threadId, body}`
  (derives To/Subject from the thread, **draft-only, no send**). Lazy auth so a missing/bad
  creds file surfaces as a tool error, not a server crash. Reads OAuth from `~/.gmail-mcp/`.
- `server/claude-spawn.ts` — `--mcp-config` now lists **both** `inbox` + `gmail` stdio
  servers; allow-list adds `mcp__gmail__get_latest_email` / `mcp__gmail__create_draft`.
- Tool contract renamed `confirmSend` → `saveDraft`; `renderLead` carries `{from, subject,
summary}`, `saveDraft` carries `{threadId, body}`. Provider prompts call `get_latest_email`
  / `create_draft`. HITL (detect-and-kill + stateless re-prime) unchanged — the resume run
  reads `{threadId, body}` from the thread's `saveDraft` call (`lastApprovalArgs`).

Why our own MCP (not the official Google one or a community pkg): see the **gotchas** in the
Handoff above (official = Workspace-preview-gated; GongRzhe = archived + classifier-blocked).
Spec/plan: `docs/superpowers/specs/2026-06-06-gmail-draft-integration-design.md` (+ plan).

## Two agents + manual handoff — BUILT (branch `feat/two-agents-handoff`)

The **second consumer** that proves the `core/` contract is reusable (the precondition for
the `@platform/*` split). A **LEAD QUALIFIER** agent beside the **REPLY AGENT** on a
two-card desktop; the manager hands the qualifier's verdict to the reply agent with one
click. Browser-verified end-to-end on the real account. Files (`apps/inbox`):

- `core/handoff.ts` — **pure, isomorphic** handoff contract: `HandoffPayloadSchema`
  (`{threadId, from, subject, summary, category, priority}`), `encodeHandoff(payload)` →
  a seed `role:'user'` message with a `[handoff]` marker, `decodeHandoff(input)` → payload
  | null. The SINGLE place that knows how a payload rides a run input — client trigger AND
  any future server/agent trigger call these; nobody hand-rolls the marker.
- `core/providers.ts` — generalized seam: `PromptStrategy` (`buildFirst(input)` +
  optional `buildResume(args)`), `ProviderConfig`, **`ProviderFactory = (config)=>Provider`**;
  `defineProviders` now holds factories. claude-cli quirks (spawn, prompts) stay out of the
  seam → a Mastra factory slots in beside `claude-cli` with no seam change.
- `core/agents/{reply,qualifier}.prompts.ts` — per-agent prompt strategies. Reply's
  `buildFirst` branches on `decodeHandoff`: handoff → use the verdict, skip `get_latest_email`;
  else standalone. `core/claude-cli-provider.ts` takes `prompts` (no baked text).
- `core/inbox.agent.ts` — `replyAgent` (id `reply`) + `qualifierAgent` (id `qualifier`,
  `tools:[renderVerdict]`, `approvals:[]`, `handoffs:['reply']`) + `agents` registry.
  `defineAgent` gained optional `handoffs`. The old `inboxAgent` is gone.
- `server/` — `buildAgent(def, prompts, registry)` builds via the factory; `providers.ts`
  registers factory entries; `index.ts` registers BOTH agents by id + validates handoff
  targets at startup.
- `mcp/inbox-tools.mjs` — adds `renderVerdict {threadId, from, subject, summary, category,
priority, reason}`; `server/claude-spawn.ts` allow-lists `mcp__inbox__renderVerdict`.
- `client/` — `VerdictCard` (+ registry); `actions.tsx` `useInboxActions(onHandoff?)`
  registers `renderVerdict` and forwards "Draft reply" → `onHandoff`. `InboxView.tsx` is a
  two-agent desktop: per-agent `useAgent`/status/modal + `requestHandoff(targetId, payload)`
  = `encodeHandoff` → seed `target.messages` → `copilotkit.runAgent` → open modal. `AgentModal`
  takes a `title`. **`App.tsx` must pass `agent={qualifierAgent.id}`** to `<CopilotKit>` — it
  binds internal listeners to `props.agent ?? 'default'`, and we no longer register `'default'`
  (crashes the tree otherwise). Found via browser E2E.

**Strict single entry point (hard boundary):** the **qualifier is the ONLY inbox reader**
(`get_latest_email`+`renderVerdict`); the **reply agent is a writer** (`renderLead`+`saveDraft`+
`create_draft`) with **no `get_latest_email`** — enforced at the permission layer via a
**per-agent MCP allow-list** (`ProviderConfig.allowedTools`, threaded passport →
`buildAgent(def, prompts, registry, allowedTools)` → `claude-cli` provider → `spawn(prompt,
allowedTools)`; lists live in `server/index.ts`: `QUALIFIER_TOOLS`/`REPLY_TOOLS`). Not just
prompts. Reply stays **launchable/openable** (manual START + click-to-open) and the card shows
**Awaiting approval**; a reply run with **no handoff** does NOT read mail — it tells the user to
start from the qualifier (`reply.prompts.ts` `noLeadFirst`). Browser-verified end-to-end on the
real account (qualifier read a real "Order: 10 units" lead → sales/hot → handoff → reply drafted
from the payload with no inbox access → approved → real Gmail draft, thread+draft id returned).

Decisions: handoff is **manual now, agent-initiated later** — the trigger is swappable, the
mechanism is fixed in `core/`. Desktop wires two agents **explicitly** (not mapped over the
registry) — N-agent mapping is deferred to the framework phase (don't over-invest early).
77 unit tests; tsc+lint+format green. Spec/plan: `docs/superpowers/specs|plans/2026-06-07-two-agents-handoff*`.

## Next after that

Multi-provider / API-key path (**Mastra** or `claude-api`) — run the same agent on models
beyond the subscription CLI, behind the existing `Provider` seam. **Still deferred:**
`defineAgent.fields` (+ auto-form), DB + config file/DB layering (base⊕overrides),
auth/RBAC/audit, the `@platform/*` package split, mode-2 visual/chat editor.

**Read before starting:** this file (Decisions + the CopilotKit v2 API notes below),
`.claude/skills/rules/copilotkit-v2.md`, `docs/ARCHITECTURE.md`, and `packages/core/src/`
(+ `packages/providers/src/`, `packages/integrations/src/`, `apps/inbox/agents/`).

## Stack

- Client: Vite + React + TypeScript
- Server: Hono (thin BFF)
- Agent UI: CopilotKit + AG-UI (`@copilotkit/runtime` v2, `@copilotkit/react-core`)
- Mocked for now: real model, Mastra, Gmail, DB, auth

## Decisions

- Server = Hono (Web-Standards / fetch; mounts CopilotKit endpoint without adapters). Swappable behind a thin layer.
- Slice verified by manual click-through; TDD + review loop starts with the reusable core layer (next phase).
- Config split (later): structure in files, manager-editable text fields in DB; secrets in env only.
- Models accessed via a separate provider registry (CLI / API); agents reference a provider by name.
- First real provider = **`claude-cli`** (subprocess), not `claude-api` (no API key; binary uses the Claude Code subscription). HITL = **detect the `confirmSend` tool call in the stream-json and kill the process** (we do NOT hold the CLI open awaiting a human — that would fight CopilotKit's client-held two-request pause). Resume = **stateless re-prime** (fresh run, "human approved"), no server-side session. The runtime **registry lives in `server/`** (not `core/`) because the real provider needs Node and `core/` is imported by the client; the injected `spawn` keeps `core/claude-cli-provider.ts` Node-free. Custom tools (`renderLead`/`confirmSend`) are exposed to the CLI via a **stdio MCP server** (`mcp/inbox-tools.mjs`); tool names arrive prefixed `mcp__inbox__…` and are stripped to the bare names the client registered.
- Core layer is now the **`@platform/core`** package (`packages/core/src/`, shared by client+server, no React/Node imports). The `@platform/*` split happened once the 2nd-consumer precondition was met (two agents + handoff): `@platform/core` (contract) + `@platform/providers` + `@platform/integrations`, in a yarn-classic workspace. `@platform/react`/`@platform/server` remain deferred. See the "Packages" section above.
- Message layer reuses `@ag-ui` types IN FULL (import `Message`/`ToolCall` from `@ag-ui/client`; derive per-role types via `Extract<Message,{role}>` — `@ag-ui/client` doesn't export `AssistantMessage`/`ToolMessage` by name). We add behavior (pure functions), not a parallel domain model. Approval tool names are a PARAMETER (from `def.approvals`), never hardcoded.
- `defineAgent.renders` is keyed BY TOOL NAME (`{ renderLead: "LeadCard", confirmSend: "ApprovalDialog" }`), refining the doc's abstract `key→component`; it drives client registration directly. Values are component _names_; the client `renderRegistry` maps name→React component (keeps `core/` React-free).
- `defineAgent` validates STRUCTURE only (`approvals ⊆ tools`, `renders` keys ⊆ `tools`). Provider-existence is enforced by `registry.resolve(def.provider)` at wiring time, not in the passport.
- `defineAgent(def)` param is typed as `AgentDefinition` (the output type), not `unknown` — deliberate: the only caller is a hand-authored literal that benefits from compile-time field checks, and `parse()` still runs the cross-field rules. Switch to `unknown` (+ `.strict()`) when config is loaded from file/DB (deferred).
- `zod` is now an explicit dependency of `apps/inbox` (was transitive); `core/defineAgent.ts` uses it directly. zod v3 API.
- **Tooling: Prettier + ESLint, adopted from the Magma house style** (`parents-web`/`teachers-web`).
  Prettier (`.prettierrc`): `semi:false`, single quotes, `trailingComma:"es5"`, `printWidth:100`. ESLint
  flat config (`eslint.config.js`) modeled on `parents-web` (web-only — RN handler rules dropped);
  `eslint-config-prettier` last so ESLint owns CORRECTNESS, Prettier owns FORMATTING. Overrides: `any`
  allowed in `**/*.test.*`, `console` allowed in `server/**`. **Lint stays green** — findings are fixed
  or justified with a scoped `eslint-disable` + comment, never left red.
- **`useAgentStatus` re-syncs messages on `agent` change in the RENDER PHASE** (prev-agent `useRef` guard +
  `setMessages`), NOT in an effect. Reason: `agent.messages` is mutated IN PLACE by CopilotKit core
  (`splice`), so `useSyncExternalStore` over `() => agent.messages` would miss updates (stable ref) and need
  a cached-ref/2nd-subscription workaround. The render-phase reset is the React "adjust state on prop change"
  pattern — clears `react-hooks/set-state-in-effect` and avoids painting a stale frame, with one subscription.
- AgentCard status is a **string literal union, deliberately NOT a TS `enum`** (zero runtime cost, value IS the wire string, `Record<Status,…>` gives exhaustiveness — enum adds a runtime object + `const enum`/bundler footguns). Single source of truth: `client/src/status.ts` — `STATUSES` (`as const` array, also a runtime list) → `Status` (derived union) → `Lifecycle` (`Exclude<Status,"awaiting_approval">`, the run-lifecycle subset). Client-only: server/provider never reference status, so it lives in `client/`, not `core/`.

### CopilotKit v2 API — CONFIRMED against installed packages

Installed versions (note: package version is 1.59.5, but a real `/v2` subpath ships inside it):

- `@copilotkit/runtime` 1.59.5
- `@copilotkit/react-core` 1.59.5
- `@ag-ui/client` 0.0.55 (re-exports `@ag-ui/core`)

**v2 subpath imports are required:** server imports come from `@copilotkit/runtime/v2`;
client hooks come from `@copilotkit/react-core/v2` (NOT the package root).

Server (import from `@copilotkit/runtime/v2`):

- `new CopilotRuntime({ agents: { default: agent }, runner: new InMemoryAgentRunner() })` — `runner` is optional.
- `new BuiltInAgent({ type: "custom", factory })` — custom factory yields raw AG-UI `BaseEvent`s.
  Factory signature: `(ctx: { input: RunAgentInput; abortController; abortSignal }) => AsyncIterable<BaseEvent>`.
- `createCopilotEndpoint({ runtime, basePath, mode })` returns a Hono app whose ONLY route is
  `ALL ${basePath}/*`. Mount it with `app.route("/", copilot)`. `createCopilotEndpoint` is a
  deprecated alias of `createCopilotHonoHandler`. Dedicated subpath also exists: `@copilotkit/runtime/v2/hono`.
- **`mode` MUST match the client transport:**
  - `mode: "multi-route"` (library default) exposes REST paths (`GET ${basePath}/info`, etc.). There is **no route
    at the bare `${basePath}`** → bare POST = 404.
  - `mode: "single-route"` exposes ONE endpoint: `POST ${basePath}` dispatched by a JSON envelope
    `{ method, params?, body? }`.
  - The v2 React client defaults to single-endpoint transport (`useSingleEndpoint ?? true`), handshake is
    `POST <runtimeUrl>` with body `{ "method": "info" }`. **Server MUST use `mode: "single-route"`**, else
    the bare POST 404s with `Runtime info request failed with status 404`.
  - **Decision: server uses `mode: "single-route"`** with `basePath: "/api/copilotkit"`.
    Verified: `curl -X POST :4000/api/copilotkit -d '{"method":"info"}'` → 200.
- AG-UI events from `@ag-ui/client`: `EventType.TEXT_MESSAGE_CHUNK` with fields `{ type, role, messageId, delta }`.

Client (import from `@copilotkit/react-core/v2`):

- `<CopilotKit runtimeUrl="/api/copilotkit">` provider.
- `useAgent({ agentId: "default", updates: [UseAgentUpdate.OnMessagesChanged] })` returns **`{ agent }`**
  (an AG-UI `AbstractAgent`). Read messages via `agent.messages`; subscribe to lifecycle events via
  `agent.subscribe({ onRunStartedEvent, onRunFinalized, onRunFailed, onMessagesChanged })`.
- **CRITICAL — runs MUST go through `copilotkit.runAgent({ agent })`** (from `const { copilotkit } = useCopilotKit()`).
  **Do NOT call bare `agent.runAgent()`.**
  - `agent.runAgent()` (the AG-UI `AbstractAgent` method) only streams one turn and accumulates messages.
    It does NOT run CopilotKit's frontend-tool pipeline. The human-in-the-loop resume lives in
    `CopilotKitCore.runAgent` → `processAgentResult`: that is what invokes the `useHumanInTheLoop` tool
    handler (resolving the `respond` Promise), splices the resulting `role:"tool"` message into
    `agent.messages`, and — because `followUp` defaults on — fires the follow-up `runAgent({ agent })`.
    That follow-up re-runs the SAME agent, so `prepareRunAgentInput` reads the now-populated
    `agent.messages` (history + the confirmSend tool call + the tool result), and the resume POST carries
    the full conversation instead of `[]`.
  - Calling bare `agent.runAgent()` bypasses all of that. The resume run would send `messages: []` and the
    agent would re-emit turn 1 instead of resuming. **Verified: `App.tsx` uses `copilotkit.runAgent({ agent })`.**
- `*.css` side-effect imports need an ambient `declare module "*.css"` (TS 6.0 strictness) — see
  `client/src/vite-env.d.ts`.

### Generative UI

v2 mechanism: **`useRenderTool`** and **`useHumanInTheLoop`** (NOT `useCopilotAction`, which is v1/absent from
`@copilotkit/react-core/v2`). Import from `@copilotkit/react-core/v2`. Register inside a component nested
under `<CopilotKit>`. Registrations live in `client/src/actions.tsx`, exported as `useInboxActions()`.

Tool registrations (both REAL and working):

- **`renderLead`** — `useRenderTool({ name, parameters, render })`: pure generative UI, maps to `<LeadCard />`.
  `render` receives `{ name, toolCallId, parameters, status, result }`. `parameters` is `Partial<T>` while
  `inProgress`, full `T` once `executing`/`complete`. Note: historical tool calls surfaced via
  `useRenderToolCall({ toolCall })` (no `toolMessage`) are reported as `status: "inProgress"` even though
  arguments are fully streamed — gate on field presence, not status.
- **`confirmSend`** — `useHumanInTheLoop({ name, parameters, render })` (REAL, not a stub):
  the hook registers a frontend tool whose handler returns a Promise that stays pending until the user acts.
  `render` receives `{ args, status, respond }` where `respond` is only present while `status === "executing"`.
  `render` returns `<ApprovalDialog ... onApprove={() => respond("approved")} />`. Calling `respond("approved")`
  resolves the Promise, the framework records a `role:"tool"` message with the matching `toolCallId`, and
  (followUp default) re-runs the agent — this is the resume turn the server detects in `approvalResolved`.

**Rendering surface:** `useRenderToolCall()` returns `({ toolCall, toolMessage? }) => ReactElement | null`.
`App.tsx` maps over `agent.messages`; `<AgentModal>` pairs each assistant `toolCalls[]` entry with its
matching `role:"tool"` message by `toolCallId` and calls `renderToolCall({ toolCall, toolMessage? })`.

### Human-in-the-Loop + Resume

The HITL flow (verified end-to-end):

1. Server emits `confirmSend` tool call events. Client-side `useHumanInTheLoop` intercepts it, returns an
   `<ApprovalDialog>` with `respond` live.
2. User clicks approve → `respond("approved")`. `CopilotKitCore` splices a `role:"tool"` message into
   `agent.messages` with the matching `toolCallId`, then fires a follow-up `copilotkit.runAgent({ agent })`.
3. Server's `approvalResolved(input)` detects the resumed turn: it collects all assistant `confirmSend`
   `toolCallId`s, then checks whether any `role:"tool"` message's `toolCallId` matches.
   **AG-UI's `ToolMessageSchema` STRIPS `name`/`toolName`** from tool result messages — name-matching cannot
   work; correlation MUST be by `toolCallId`.
4. Server emits "Done — reply sent." and the run finalizes.

### Status Derivation

`useAgentStatus(agent)` in `client/src/useAgentStatus.ts`:

- **Lifecycle** (`running`/`done`/`error`) comes from `agent.subscribe({ onRunStartedEvent, onRunFinalized, onRunFailed })`.
- **`awaiting_approval`** is derived from MESSAGE STATE via pure `hasPendingApproval(messages)`:
  a `confirmSend` tool call exists in messages with no matching `role:"tool"` result.
- This is **render-independent**: the closed AgentCard shows "Awaiting approval" even when the modal (and
  `<ApprovalDialog>`) are not mounted.
- `awaiting_approval` **takes priority over `done`**: `onRunFinalized` fires at the end of turn 1, at the
  exact moment the agent pauses for the human. Without the message-state override, lifecycle would read "done"
  while still awaiting approval. Only a terminal `error` wins over `awaiting_approval`.
- **Do NOT derive `awaiting_approval` from a tool's render/executing callback** — that only fires when the
  modal is open (a bug we already hit and fixed).

### Known Issues (Benign)

- `GET /api/copilotkit/threads?agentId=default` → **405 in single-route mode** is BY DESIGN. Single-route
  serves only the POST envelope endpoint; `/threads` is a multi-route / Intelligence feature. The client
  tolerates it gracefully. Not a bug.

Toolchain note: Vite 8 uses rolldown; npm did not auto-install the platform binding, so
`@rolldown/binding-darwin-arm64` is pinned as an explicit devDependency (macOS arm64 only — revisit for CI/other OS).

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
