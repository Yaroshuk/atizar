# Build log — what's been built, in order

Chronological record of the BUILT milestones. `CLAUDE.md` is the lean operational
index; this file holds the detailed per-feature narratives (each also has a spec under
`docs/superpowers/specs/`). Newest entries at the bottom.

---

## 1 · Vertical slice + reusable core layer (BUILT, browser-verified)

The vertical slice loop works AND the reusable core layer is extracted into
`@platform/core` (was `apps/inbox/core/`):

- `@platform/core` (`messages.ts`) — typed message layer over `@ag-ui`
  (`hasPendingApproval`, `approvalResolved`, `pairToolResults`, guards). Replaces the
  `toolCallId↔toolMessage` logic that was duplicated in 3 files; no more `any`.
- `@platform/core` (`providers.ts` contract) + `@platform/providers` (`mock-provider.ts`)
  — `Provider` interface (`run(input) → AsyncIterable<BaseEvent>`) + `defineProviders`
  registry + one fake provider that emits the scripted inbox stream.
- `@platform/core` (`defineAgent.ts`) + `apps/inbox/agents/` — the Zod-validated agent
  passport + the concrete inbox instances (`replyAgent`/`qualifierAgent`, registries).
- Threaded through both sides: server (`apps/inbox/server/build-agent.ts`) builds the
  `BuiltInAgent` from the passport + registry; client (`renderRegistry.tsx`, `actions.tsx`,
  `useAgentStatus.ts`, `AgentModal.tsx`, `App.tsx`) reads the passport. The hardcoded
  `"confirmSend"`/`"renderLead"`/`"LeadCard"` strings are gone.

Behavior: closed card Idle → Working → Awaiting approval → Done; modal thread = assistant
text + LeadCard + ApprovalDialog; approve → resume → "Done — reply sent." 28 unit tests.
Specs: `docs/superpowers/specs/2026-06-06-inbox-vertical-slice-design.md` (+ plan),
`docs/superpowers/specs/2026-06-06-core-layer-design.md` (+ `plans/2026-06-06-core-layer.md`).

---

## 2 · First real provider — `claude-cli` (BUILT, `feat/claude-cli-provider`)

Runs the **real `claude` CLI as a subprocess** behind the `Provider` seam (chosen over
`claude-api` — no API key; the binary uses the Claude Code subscription login). Files
(`apps/inbox`):

- `core/claude-stream.ts` — pure NDJSON→AG-UI parser (isomorphic). Handles BOTH streamed
  `stream_event` deltas and complete top-level `assistant` messages (deduped), strips the
  `mcp__inbox__` tool prefix, surfaces `result` errors as text, and STOPS after the approval
  tool call (HITL pause). Skips `<synthetic>` message text.
- `core/claude-cli-provider.ts` — `Provider` factory with an **injected** `spawn` (keeps
  `core/` Node-free). Turn 1 = canned-lead prompt → stream → stop at `confirmSend`, kill.
  Resume (approval resolved) = **stateless re-prime** (fresh run, "human approved").
- `server/claude-spawn.ts` — the real Node spawn (`claude -p … --mcp-config …
  --output-format stream-json`), 120s timeout, spawn-error/timeout surfaced as a result line,
  temp config dir cleaned up, `ANTHROPIC_API_KEY` deleted (force subscription auth). **Do NOT
  pass `--bare`** — it skips keychain reads, so the subscription OAuth token isn't found →
  every run returns "Not logged in".
- `mcp/inbox-tools.mjs` — stdio MCP server exposing `renderLead`/`confirmSend` (handlers are
  trivial acks; the UI is driven by emitted AG-UI events).
- `server/providers.ts` — runtime registry (`mock` + `claude-cli`), **server-side** (the real
  provider needs Node and `core/` is imported by the client); the injected `spawn` keeps
  `core/claude-cli-provider.ts` Node-free.

41 unit tests; browser-verified end-to-end (START → real `claude` reads the canned lead →
drafts a reply → `renderLead` + `confirmSend` → pause → approve → resume → "Done"). Spec:
`docs/superpowers/specs/2026-06-06-first-real-provider-design.md` (+ plan).

**Loader:** while a run is active the card swaps its status dot for a spinner and the modal
shows a trailing "Working…".

**Open TODO (not blocking):** the model reaches MCP tools via a built-in `ToolSearch` step
and sometimes narrates it. Do NOT hard-disallow `ToolSearch` (that's how it finds the tools);
tighten the available-tool set / permission config instead. The model still narrates a bit
("I'll load the inbox tool schemas…") despite the anti-narration prompt line — tune the
prompt or strip pre-tool chatter client-side.

---

## 3 · Gmail draft integration (BUILT, `feat/gmail-draft-integration`)

The first real integration. The inbox agent reads your **latest real Gmail email** and, on
one human click, saves a **draft reply** in Gmail (variant B — never sends; the human sends
from Gmail). Browser-verified on a real account. Files (`apps/inbox`):

- `mcp/gmail-format.mjs` — **pure** helpers (unit-tested): `parseLatestMessage` (Gmail full
  message → `{threadId, from, subject, body}`, base64url decode + text/plain walk) and
  `buildReplyRaw` (RFC822 reply MIME, `Re:`-no-double-prefix, base64url).
- `mcp/gmail-tools.mjs` — our **own thin stdio Gmail MCP** on the standard `googleapis` Gmail
  API. Tools: `get_latest_email` (no args) + `create_draft {threadId, body}` (derives
  To/Subject from the thread, **draft-only, no send**). Lazy auth so a missing/bad creds file
  surfaces as a tool error, not a crash. Reads OAuth from `~/.gmail-mcp/`.
- `server/claude-spawn.ts` — `--mcp-config` lists **both** `inbox` + `gmail` stdio servers;
  allow-list adds `mcp__gmail__get_latest_email` / `mcp__gmail__create_draft`.
- Tool contract renamed `confirmSend` → `saveDraft`; `renderLead` carries `{from, subject,
  summary}`, `saveDraft` carries `{threadId, body}`. HITL (detect-and-kill + stateless
  re-prime) unchanged — the resume run reads `{threadId, body}` from the thread's `saveDraft`
  call.

Why our own MCP (not Google's or a community pkg): the official Google Gmail MCP is
Workspace-preview-gated (403s for personal `@gmail.com`); `@gongrzhe/server-gmail-autoauth-mcp`
is archived + blocked by the Claude Code safety classifier. Spec:
`docs/superpowers/specs/2026-06-06-gmail-draft-integration-design.md` (+ plan).

---

## 4 · Two agents + manual handoff (BUILT, `feat/two-agents-handoff`, MERGED `56f07d0`)

The **second consumer** that proves the `core/` contract is reusable (the precondition for the
`@platform/*` split). A **LEAD QUALIFIER** agent beside the **REPLY AGENT** on a two-card
desktop; the manager hands the qualifier's verdict to the reply agent with one click. Files
(`apps/inbox`, paths pre-split — now under `@platform/core`):

- `core/handoff.ts` — **pure, isomorphic** handoff contract: `HandoffPayloadSchema`
  (`{threadId, from, subject, summary, category, priority}`), `encodeHandoff(payload)` → a seed
  `role:'user'` message with a `[handoff]` marker, `decodeHandoff(input)` → payload | null. The
  SINGLE place that knows how a payload rides a run input — client trigger AND any future
  server/agent trigger call these; nobody hand-rolls the marker.
- `core/providers.ts` — generalized seam: `PromptStrategy` (`buildFirst(input)` + optional
  `buildResume(args)`), `ProviderConfig`, **`ProviderFactory = (config)=>Provider`**;
  `defineProviders` now holds factories. claude-cli quirks stay out of the seam → a Mastra
  factory slots in beside `claude-cli` with no seam change.
- `core/agents/{reply,qualifier}.prompts.ts` — per-agent prompt strategies. Reply's `buildFirst`
  branches on `decodeHandoff`: handoff → use the verdict, skip `get_latest_email`; else standalone.
- `core/inbox.agent.ts` — `replyAgent` (id `reply`) + `qualifierAgent` (id `qualifier`,
  `tools:[renderVerdict]`, `approvals:[]`, `handoffs:['reply']`) + `agents` registry.
  `defineAgent` gained optional `handoffs`.
- `server/` — `buildAgent(def, prompts, registry)` builds via the factory; `index.ts` registers
  BOTH agents by id + validates handoff targets at startup.
- `mcp/inbox-tools.mjs` — adds `renderVerdict`; `claude-spawn.ts` allow-lists it.
- `client/` — `VerdictCard` (+ registry); `actions.tsx` `useInboxActions(onHandoff?)` registers
  `renderVerdict` and forwards "Draft reply" → `onHandoff`. `InboxView.tsx` is a two-agent
  desktop: per-agent `useAgent`/status/modal + `requestHandoff(targetId, payload)` =
  `encodeHandoff` → seed `target.messages` → `copilotkit.runAgent` → open modal. **`App.tsx`
  must pass `agent={qualifierAgent.id}`** to `<CopilotKit>` (it binds listeners to
  `props.agent ?? 'default'`, and we no longer register `'default'`). Found via browser E2E.

**Strict single entry point (hard boundary):** the qualifier is the ONLY inbox reader; the
reply agent is a writer with **no `get_latest_email`** — enforced at the permission layer via a
**per-agent MCP allow-list** (`server/index.ts`: `QUALIFIER_TOOLS`/`REPLY_TOOLS`, threaded
passport → `buildAgent(…, allowedTools)` → provider → `spawn(prompt, allowedTools)`). Not just
prompts. A reply run with no handoff does NOT read mail — it tells the user to start from the
qualifier (`reply.prompts.ts` `noLeadFirst`).

Decisions: handoff is **manual now, agent-initiated later** — trigger swappable, mechanism fixed
in `core/`. Desktop wired two agents **explicitly** (N-agent mapping deferred). 77 unit tests.
Spec/plan: `docs/superpowers/specs|plans/2026-06-07-two-agents-handoff*`.

---

## 5 · `@platform/*` package split (BUILT, `feat/platform-package-split`, browser-verified)

The library is extracted into a **yarn-classic (1.22) workspace**. Layout:

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
  concrete** (just `@ag-ui/client` + `zod`). `@platform/providers` is **isomorphic** (the `spawn`
  is INJECTED, so it stays Node-free). `@platform/integrations` is **node-only batteries** with
  **subpath exports** (`./gmail-basic`, `./gmail-basic/format`) + **optional peer deps**
  (`googleapis` is loaded lazily inside the MCP server via `optional-peer.mjs` → `optionalPeerError`,
  fail-fast; the app installs it because it uses the entrypoint).
- **No build step — consume raw TS source:** each package's `exports` points at `./src/index.ts`;
  Vite + tsx + vitest transpile workspace deps directly. Typecheck = `tsc --build` (composite
  project references).
- `apps/inbox/server/claude-spawn.ts` resolves the gmail MCP server via
  `require.resolve('@platform/integrations/gmail-basic')` (createRequire), not a relative path.
  The app's OWN generative-UI tools `mcp/inbox-tools.mjs` stayed in the app (contract, not
  integration).
- The contract (`@platform/core`) is what enables third-party extension. **`@platform/*` is a
  placeholder scope — rename before any npm publish.** `@platform/react` + `@platform/server` are
  deferred (client + server layers still live in `apps/inbox/`).

79 unit tests; browser-verified end-to-end on real Gmail.

---

## 6 · Consumer desktop re-skin — Smedja design system (BUILT, `56c8454`, browser-verified)

The Smedja design system (exported from Claude Design; bundle decoded from the
`api.anthropic.com/v1/design/...` gzip→tar) applied to `apps/inbox/client`. The flat two-card
view became a **two-panel desktop**: a left **Pipeline** column + a right **Your agents** grid,
each under the SAME thin `.comp-head` (icon + title).

- Tokens (`#f5f5f7`/`#fff`/teal `#0a7`/amber, radii, soft shadows, system-ui) in
  `client/src/styles.css`; the 5 components (`AgentCard`, `AgentModal`, `LeadCard`, `VerdictCard`,
  `ApprovalDialog`) re-skinned (markup+classes only, CopilotKit/AG-UI logic untouched).
- New `components/Icon.tsx` (one component + `Record<IconName, paths>` line icons).
- New `components/PipelineColumn.tsx` + pure `client/src/pipeline.ts` (`activePipeline`): the
  pipeline shows an agent if it's active (`running`/`awaiting_approval`/`error`) OR is a handoff
  ancestor of an active agent — a done/idle **parent stays visible (shown as Working) while its
  subagent is active**. Ordered source-before-target by `def.handoffs`, tinted green/amber/red,
  connected by a ↓; transitive + cycle-safe.
- `status.ts` gained `STATUS_LABEL`. Per-agent subtitle+icon passed client-side from `InboxView`
  (core `defineAgent` passport left untouched — a `subtitle`/`icon` field is deferred).
- Handoff-only agents (reply) show **no START** (card shows "Runs from a handoff"); launchability
  derived from the handoff graph. START also appears in the agent modal footer for launchable
  agents.
- **DROPPED by the user** (in the design but not wanted): left icon rail/sidebar, global top bar,
  Manager/Admin, account, notifications, admin settings, Leads table, run history.

88 unit tests, tsc+lint+format+build green; browser-verified E2E on real Gmail (qualifier →
verdict sales/hot → handoff → reply draft → amber approval → real Gmail draft id returned;
pipeline lit qualifier-green while reply sat at amber). Spec:
`docs/superpowers/specs/2026-06-07-consumer-desktop-reskin-design.md`. The design bundle
(reference) also carries a richer v2/v3 (Lead Manager fan-out, multi-lead triage, dispatch card)
we did NOT build.
