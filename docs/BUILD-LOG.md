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

## 7 · GitHub triage workflow — real Magma Board, read-only (BUILT, `feat/github-triage-workflow`, browser-verified)

A second workflow beside the Lead inbox, and the N-agent desktop it forced. **TRIAGE** reads the
user's own open tickets off the **real** GitHub Projects v2 board (`matteappen` org, project #8 —
"Magma Board") via `gh`, buckets them by Status, and recommends a route per ticket; the manager
routes one (manual handoff, reusing `handoff.ts`) to **FEATURE**, **BUG-FIX**, or **REPLY-DRAFT**,
which analyze/draft **purely from the handoff payload**. **Strictly read-only** — nothing is ever
posted, commented, or modified on GitHub. Spec:
`docs/superpowers/specs/2026-06-07-github-triage-workflow-design.md`; plan:
`docs/superpowers/plans/2026-06-07-github-triage-workflow.md`.

- **Why real `gh`, no mock:** the `claude-cli` provider runs the real `claude` binary, and `gh` is
  authenticated (`Yaroshuk`, `read:project`/`project` scopes). The board has 1785 items; the user
  is assigned 27. So "real GitHub" needed only a thin **read-only adapter** — the planned mock MCP
  was dropped. The model has **no Bash** (it's in the spawn deny-list), so the MCP adapter is the
  ONLY path to GitHub, and it exposes no write tool → read-only by construction.
- **Core (`packages/core/src/handoff.ts`):** generalized `decodeHandoff(input, schema)` to take the
  zod schema (the Gmail caller passes `HandoffPayloadSchema`; no behavior change) + added
  `TicketHandoffPayloadSchema` (`repo, number, title, status, priority, body, lastComment, recommendation, url`).
  `encodeHandoff(payload: unknown)`.
- **Read-only adapter (`apps/inbox/mcp/github-tools.mjs` + pure `github-format.mjs`):** shells `gh`
  via `execFile`. `list_my_tickets` → ONE `gh api graphql` **search** query scoped to the user's
  open issues (it does NOT page the whole 1785-item board — that exhausted the hourly GraphQL
  budget; see the follow-up below), pulling each ticket's board Status/Priority + last comment
  inline. Keeps only `Todo / In progress / On pluto / Ready for mars`, caps at 20; couriered
  body/comment trimmed small (400/240) so the model can re-emit them without stalling the run.
  `get_ticket` (TRIAGE only) reads one issue, trimmed. Render acks
  `render_triage`/`render_ticket_result`/`render_reply_draft`. NO mutating `gh` call anywhere.
  (Pure parser: `mapSearchNodes`.) **Follow-up after first ship:** the original cut paged the full
  board via `gh project item-list` and enriched comments over REST (N+1) — a handful of triage runs
  exhausted the 5000-point/hr GraphQL budget; the search query above replaced it. The triage card
  also went from three route buttons to one (the recommended route) + an "Open in browser" link,
  and each agent shows a "what I'm doing" intro bubble plus chronological handoff notes
  (receiver "← Received …" at top, sender "→ Handed …" at bottom).
- **Single board reader:** only TRIAGE has `list_my_tickets`/`get_ticket`. FEATURE/BUG-FIX/REPLY-DRAFT
  have **no GitHub tool at all** — they work from the (self-contained) handoff payload TRIAGE
  couriers through `render_triage`. Enforced by the per-agent allow-lists in `server/index.ts`
  (`TRIAGE_TOOLS`/`FEATURE_TOOLS`/`BUGFIX_TOOLS`/`REPLY_DRAFT_TOOLS`). No agent has any approval.
- **N-agent desktop + workflow switcher:** generalized `InboxView` from two hardcoded `useAgent`
  calls to map over a `workflows` registry (`client/src/workflows.ts`: Lead inbox = [qualifier,
  reply]; GitHub triage = [triage, feature, bugfix, reply-draft]). Each agent's hooks live in a
  child `AgentRuntime` (one `useAgent`+`useAgentStatus`, publishes `{agent,status}` up) — the
  rules-of-hooks fix for a variable agent count. `WorkflowSwitcher` tabs between them; both
  workflows' render tools register unconditionally. New cards `TriageCard` (groups by real Status
  via pure `buckets.ts`, needs-reply pills, route buttons), `TicketResultCard`, `ReplyDraftCard`.
- **Subtle bug caught by review + browser, NOT by types/tests:** `useRenderTool`'s effect deps
  stringify a function to `"[null]"`, so its render closure is captured ONCE. The first cut made
  `requestHandoff` depend on `handles` state → it froze the initial empty map → every handoff
  silently no-opped. Fix: read handles via a `useRef` mirror, keep `requestHandoff` stable
  (`[copilotkit]`), pass it directly to the action hooks. (This is exactly why the project's
  always-run-browser-E2E rule exists — green types + 103 unit tests would have shipped a dead
  pipeline.)

103 unit tests, tsc+lint+format+build green. **Browser-verified E2E on the real board:** GitHub
triage → START → TriageCard with the real 20 open tickets grouped by Status (Backlog → Todo →
In progress → On pluto → …) with needs-reply pills → route #4403 to BUG-FIX → analysis card built
only from the payload (it cited the "can't reproduce on Mars" last comment, made no `gh` call) →
**read-only confirmed: #4403 comment count unchanged**. Gmail workflow re-verified intact (qualifier
→ verdict sales/hot → Draft reply handoff → reply draft → amber approval; pipeline lit qualifier
Working → reply Approve). Follow-up deferred: a proper workflow-separation pass (the user flagged
splitting flows comes later) and per-workflow desktop chrome.

---

## 8 · Workflow separation — self-contained modules, roles, cross-workflow contract (BUILT, `feat/workflow-separation`, browser-verified)

A "workflow" was a filter over one shared everything (flat server agent map, one shared
`InboxView`, one `META`, render tools registered globally). Now each workflow is a **self-contained
module** and workflows are **isolated boxes** that talk only through a typed contract.

What changed:

- **`@platform/core` `defineWorkflow`** (`packages/core/src/defineWorkflow.ts`) — a pure, structure-
  only validator (mirrors `defineAgent`) for a `WorkflowDescriptor` (`{id, label, iconName, agents:
  {agent, role}[], entryAgentId, inputs}`). Adds `instanceId(workflowId, agentId)` (`wf__agent`) and
  the `Destination` union (`{kind:'agent',agentId}` | `{kind:'contract',workflow,input}`).
- **Agent roles `input | worker`** — a property of an agent's *placement*, not the def. `input` =
  user-startable + the only cross-workflow delivery target; `worker` = reachable only via an
  intra-workflow handoff. Replaces the old `handoffTargets`/`canStart` derivation.
- **Module layout** — `apps/inbox/workflows/<id>/{descriptor.ts (core), server.ts (prompts +
  allow-lists), client.tsx (render specs + META)}`, plus thin aggregators
  (`workflows/index.ts`, `server/workflows.ts`, `client/src/workflows.ts`). Adding a workflow = a
  folder + one line per aggregator; no shared file bodies edited. The old `inbox.agent.ts`/
  `github.agent.ts` flat defs were deleted (moved into descriptors).
- **Published-contract cross-workflow door (Variant 1)** — a workflow publishes named typed inputs
  `{name, schema, agentId}`; the public face is `{name, schema}` (the bound agent is private). A
  source addresses `{kind:'contract', workflow, input}` — never a foreign agent. `resolveDelivery`
  (`client/src/deliver.ts`, pure + unit-tested) validates the payload against the contract schema
  before routing to the private input agent.
- **All agents mounted idle (Variant A)** — the shell mounts an invisible `AgentRuntime` for **every**
  workflow × agent, keyed by instance id, for the whole session (`AgentRuntime` gets `def={{...def,
  id: instanceId(...)}}` so each placement is an independent `useAgent`). The active-workflow state
  only selects the view; `handles` is global and never cleared on switch (conversations persist).
  This makes a cross-workflow target always-ready (no mount-then-run race) and is what makes the same
  agent reusable as independent copies.
- **One `deliver` seam** (`InboxView`) replaces `requestHandoff`: resolves the target, seeds
  (`encodeHandoff`) + `runAgent` in the **background**. **No auto-open** of the target modal (the old
  `setOpenId` is gone) and **no auto-switch** of the workflow. Cross-workflow delivery raises an
  unread **badge** on the target's switcher tab + an **"Open in <workflow>"** button in the source
  thread; the human navigates. `deliver` is a STABLE `useCallback` (`[copilotkit]`) reading the
  active workflow via a `useRef` mirror — required because `useRenderTool` captures its render
  closure once.
- **Origin-routed reuse** — the two handoff-emitting render tools (`renderVerdict`, `render_triage`)
  carry an `origin` (workflow id) param, injected by the per-instance prompt (same mechanism
  `ticket.prompts` uses for `kind`). A single shared render registration reads `parameters.origin`
  and routes the handoff to the correct copy, so handoff-emitting agents reuse cleanly. Render specs
  are declared as data per module and registered **once per unique tool name** (`useWorkflowRenders`).
- **Concrete cross-workflow demo** — the TRIAGE card's "Treat as lead → Lead inbox" maps a ticket to
  the lead-inbox `lead` contract (`HandoffPayloadSchema`); the qualifier gained a `fromHandedLead`
  prompt path that re-qualifies a handed lead instead of reading the inbox.

122 unit tests; `tsc --build` + lint + prettier all green. **Browser-verified E2E (real board +
real Gmail):** (1) Lead inbox: qualifier → verdict (spam/cold) → "Draft reply" **ran** REPLY but did
**not** auto-open its modal; REPLY ran to *awaiting approval*. (2) GitHub triage read the **real**
Magma board read-only (13 tickets bucketed by real Status) — only `list_my_tickets`/`get_ticket`
exposed, model has no Bash, nothing mutated. (3) Cross-workflow: "Treat as lead" on #5784 ran
`lead-inbox__qualifier` **in the background** (it took the handed-lead path, re-qualified printernet
as other/warm), the **Lead inbox tab showed a badge "1"**, the view **stayed** on GitHub triage, and
"Open in lead-inbox" switched + cleared the badge. (4) **State persisted**: REPLY stayed *awaiting
approval* across the round-trip of workflow switches. (5) All six instance-ids mounted (visible in
the per-agent `/threads` probes); no "Agent 'default' not found" throw; role-based START.

Known cosmetic (not blocking): per-instance `handoffNotes` accumulate, so a re-seeded agent still
shows its earlier "sent" note alongside the new "received" one (a side-log, not the thread).
Spec: `docs/superpowers/specs/2026-06-08-workflow-separation-design.md`; plan:
`docs/superpowers/plans/2026-06-08-workflow-separation.md`.

## 9 · Dynamic agent instances (BUILT, `feat/agent-instances`, browser-verified)

**Problem.** There was exactly one runtime copy of each agent per workflow (`wf__agent`), mounted idle
for the session; `deliver` overwrote its `messages` and re-ran it. So handing a second item to a busy
agent **overwrote the in-flight run** — no concurrency.

**What shipped.** A busy agent now spawns additional concurrent copies, bounded by a per-agent cap,
with overflow queued; the pipeline shows the live copies as nested instance cards.

- **`maxInstances` on the passport** — `defineAgent` gains `maxInstances` (zod `.default(2)`; a cap of
  1 = singleton, no separate flag). The two workflow input agents (`triage`, `qualifier`) are set to 1.
  (zod input/output split: `AgentDefinitionInput` for callers, `AgentDefinition` for the parsed value.)
- **Dynamic proxied instances — server unchanged.** The client creates an instance on demand via
  `copilotkit.registerProxiedAgent({ agentId: localId, runtimeAgentId: wf__agent })` (localId =
  `wf__agent#<seq>`), seeds the handoff message, `runAgent`s it, subscribes for status, and
  `unregister`s on finalize. The server still registers ONE agent per `wf__agent`; stateless re-prime
  makes concurrent runs on distinct threads safe. No `AgentsFactory`, no lane pool. Nothing exists at
  startup — instance count tracks actual work, so a large agent catalog costs nothing idle.
- **Cap + queue.** `spawn` starts an instance when live copies `< maxInstances`, else enqueues per
  runtimeKey; a freed slot (on a torn-down instance) drains the next queued item. The cap holds even
  against same-tick bursts because `useAgentInstances` keeps `instRef` as the **synchronous** source of
  truth (a `commit` helper mutates the ref alongside `setInstances`) — reading the React `instances`
  state instead would let several same-tick `spawn`s all pass the check before any commit.
- **Lifecycle.** A `done` instance is torn down immediately, EXCEPT: a workflow **input** agent (kept as
  the pipeline root) and a **parent with a live child** (kept, shown Working). An **errored** instance
  is kept and keeps its slot (gated on the authoritative local `lifecycle`, not the lagging ref status).
- **Pipeline = instance tree.** `pipelineModel.buildPipeline` (pure) builds repeated depth-2
  `parent → [children grouped by agentId]` blocks: 1 instance → a single card; ≥2 of one agent → an
  agent mini-header (`N active`) + the instances nested with L-connectors; a `queued: N` line under the
  group; a dispatched instance that itself dispatches reappears as its own parent block (one agent can
  show twice). Labels: `#<number> · <title>` (github) / sender (email), title truncates with ellipsis.
- **Type card aggregate.** The right-grid `AgentCard` is the agent TYPE; `aggregate.ts` reduces its live
  instances to `N active · M awaiting approval` (priority awaiting_approval > error > running > done).
- **Decomposition.** Pure + unit-tested: `instancesCore` (cap), `statusFrom` (shared with
  `useAgentStatus`), `aggregate`, `pipelineModel`. Integration: `useAgentInstances` (the manager),
  `InboxView` (deliver→spawn, Start→spawn, aggregate), `PipelineColumn` (render), `AgentCard`.

137 unit tests; `tsc --build` + lint + prettier all green. **Browser-verified E2E (real Magma board,
read-only):** started TRIAGE (proxy `triage#1`, read the real 14-ticket board, rendered the TriageCard);
routed **3 "Draft reply" tickets in one tick** → pipeline showed **REPLY DRAFT `2 active` + two
L-connected instance cards (#5197, #5641) + `queued: 1`** (cap held); the queue **drained** (the 3rd
started when a slot freed) and all torn down to the kept TRIAGE root; a single routed ticket renders as
one card (no header); the type card showed the aggregate; **no page reload at any point**.

Found-and-fixed during build/verify: (1) errored instances were torn down (stale-ref status read →
gate on local `lifecycle`); (2) the pipeline `shown` set wrongly kept done descendants (dropped the
buggy downward fixpoint, upward-only); (3) the cap leaked under same-tick deliveries (synchronous
`instRef`). Known-benign: a transient `Agent <localId> not found` console warning on teardown (an
unregister/pending-probe race); a queued item gets no "received" handoff note until it actually
starts (the drain path re-enters `start`, not `deliver`) — the "sent" note on the source is unaffected.
The folded-away `AgentRuntime.tsx`/`useAgentStatus.ts` (their status logic now lives in `statusFrom.ts`,
which `useAgentInstances` subscribes to directly) were deleted as part of this work. **Environment lesson** (now in CLAUDE.md): an "app reloads itself ~30s
into a run" symptom was 5 stale dev stacks contending for `:5173` → Vite `vite:ws:disconnect →
location.reload`, not a feature bug; the kill pattern pointed at the wrong (`apps/inbox`) `node_modules`
path — binaries are hoisted to the workspace root.
Spec: `docs/superpowers/specs/2026-06-08-agent-instances-design.md`; plan:
`docs/superpowers/plans/2026-06-08-agent-instances.md`.
