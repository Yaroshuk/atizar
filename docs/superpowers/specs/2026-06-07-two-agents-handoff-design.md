# Two agents + manual handoff — design

**Date:** 2026-06-07
**Status:** DESIGN INTENT (approved in brainstorming, not yet built)
**Builds on:** `apps/inbox/` core layer + `claude-cli` provider + Gmail draft integration.

## 1. Goal & why now

Add a **second agent** (a lead **qualifier**) alongside the existing reply agent, and
let work pass between them via a **manual handoff** (the manager clicks). This is the
deliberate "second consumer" test the architecture says must exist before the
`@platform/*` package split — it proves the `core/` contract is genuinely reusable and
surfaces the inter-agent seam that will become the framework.

Two cross-cutting decisions shaped this design (both from the brainstorm):

- **Handoff is manual now, agent-initiated later.** The trigger must be swappable: a
  human click today, an agent's own decision tomorrow. So the handoff *mechanism* cannot
  live in the click handler.
- **Mastra is coming; the claude-cli provider stays.** They must coexist as peers behind
  the existing `Provider` seam. Nothing in this spec may bake claude-cli quirks into the
  seam or `core/` in a way that blocks a future Mastra provider.

## 2. Scope

**In:** qualifier agent passport; reply agent renamed; provider generalized to per-agent
prompt strategies; multi-agent server registration; multi-agent client desktop; the
`core/handoff` contract (encode/decode + payload schema); a `renderVerdict` MCP tool +
`VerdictCard`; the human-trigger wiring; tests; browser verification on a real account.

**Out (YAGNI / deferred):** server-side orchestration or sessions; auto/agent-initiated
handoff trigger (only the seam is built, ready for it); `defineWorkspace`; the
`@platform/*` split; a real Mastra provider; new Gmail tools; the polish backlog
(ToolSearch narration, Gmail scope tightening).

## 3. The two agents (passports, `core/`)

- `inbox.agent.ts` → **`replyAgent`** (`id: 'reply'`). Behaviour unchanged in standalone
  mode: `get_latest_email → renderLead → saveDraft → (approve) → create_draft`.
- New **`qualifierAgent`** (`id: 'qualifier'`): `get_latest_email → renderVerdict → done`.
  No approval pause. `handoffs: ['reply']`.
- A passport **registry** exported from `core/` (`agents = [qualifierAgent, replyAgent]`),
  mapped over by both client (cards) and server (runtime registration).

`defineAgent` gains an optional **`handoffs?: string[]`** (target agent ids this agent may
hand to). Validated structurally only; membership in the agent registry is checked at
wiring time (same pattern as `provider` — a passport doesn't know the registry).

## 4. Provider generalization (`core/` + `server/`)

The `claude-cli` provider currently bakes inbox-reply prompts (`firstPrompt`/`resumePrompt`)
inside itself. Two agents need different prompts on the same provider, so:

- Per-agent **prompt strategies** move into `core/` modules (`core/agents/reply.prompts.ts`,
  `core/agents/qualifier.prompts.ts`) — pure, isomorphic string builders.
- `createClaudeCliProvider` becomes generic: it receives `buildFirstPrompt(input)` and
  `buildResumePrompt(args)` by injection instead of hardcoding them.
- `defineProviders` holds **factories** `(agentConfig) → Provider`, not pre-built instances
  (two agents → two configurations of one `claude-cli`). `buildAgent(def, prompts, registry)`
  resolves the factory by `def.provider` and constructs the provider from the passport +
  its prompt strategy.
- `server/index.ts` registers **both** agents: `agents: { qualifier: …, reply: … }`.

Server-side, an agent is assembled as a small bundle `{ def, prompts }`; the client only
ever imports the `def` (passport), keeping `core/` React-free for the client.

## 5. Handoff layering (the framework seam)

The mechanism is split across layers so the *trigger* can move without rewriting the
*mechanism*:

- **`core/handoff.ts` (the library piece — pure, isomorphic):**
  - `HandoffPayload` — a zod schema. For this phase: `{ threadId, from, subject, summary,
    category, priority }`. Generalization to an arbitrary payload is deferred until a 3rd
    case needs it.
  - `encodeHandoff(payload) → seed` and `decodeHandoff(input: RunAgentInput) → payload | null`
    — the **single place** that knows how a payload rides on a run input. Whether it rides
    as a structured seed message or `forwardedProps` is an implementation detail hidden
    here; the exact CopilotKit/AG-UI transport is chosen during implementation (likely a
    structured seed message, the proven transport), but no consumer hand-rolls it.
  - The reply prompt strategy calls `decodeHandoff(input)` — it does **not** sniff string
    markers itself.
- **`client/` — the human trigger only:** a `handoff(targetAgentId, payload)` helper:
  `encodeHandoff(payload)` (from core) → seed the target run → `copilotkit.runAgent({ agent })`
  → open the target modal. The client routes; it does not own the payload shape. "Who can
  hand to whom" comes from the passport `handoffs`.
- **`server` / future runtime — the agent trigger (not built now):** when agents hand off
  themselves, a server-side router (this is where **Mastra** lands) catches a handoff event
  from agent A's stream and invokes agent B via the **same** `encodeHandoff`. The client is
  not involved. This is why the mechanism must be in `core/`, not in the click handler.

Reply's `buildFirstPrompt(input)`:
- handoff seed present → "a colleague qualified this lead: `<verdict>`; draft a reply to
  thread `<threadId>` (from `<from>`, subject `<subject>`); call renderLead → saveDraft."
  **`get_latest_email` is skipped** — context is already in the payload.
- no seed → existing standalone path. Reply keeps its standalone START button.

## 6. Tools / MCP

- New `mcp/inbox-tools.mjs` tool: **`renderVerdict { threadId, from, subject, summary,
  category, priority, reason }`** (trivial ack, like `renderLead`; the UI is driven by
  emitted AG-UI events). `summary` is the qualifier's read of the email body — it lets
  reply draft without re-reading; `reason` is the classification rationale (shown on the
  card, not needed for drafting). `threadId` is carried so the client can assemble the
  handoff payload `{ threadId, from, subject, summary, category, priority }`.
- `server/claude-spawn.ts` allow-list += `mcp__inbox__renderVerdict`.
- **No new Gmail tools** — reply acts on `threadId` (already enough for `create_draft`).
- Tool *contract* (name + zod shape) is declared once in the passport/registration; the
  claude-cli binding is the stdio MCP server. A future Mastra binding reuses the **same**
  MCP servers (Mastra speaks MCP) — tools are not written twice.

## 7. Client desktop (multi-agent)

- `InboxView` → a desktop that maps over the passport registry; each agent renders one
  `<AgentSlot def={…} />`. Hooks (`useAgent` / `useAgentStatus` / per-agent action
  registration) are called once per slot — legal because the agent list is static.
- New `VerdictCard` (registered for `renderVerdict`): shows category/priority/reason + a
  **"Draft reply"** button → `handoff('reply', payload)`. The button is hidden when
  `threadId` is absent (same field-presence gating as `LeadCard`).
- `renderRegistry` += `VerdictCard`.
- Per-agent renderer registration derived from each passport's `renders`
  (`renderVerdict → VerdictCard` for qualifier; `renderLead → LeadCard`,
  `saveDraft → ApprovalDialog` for reply). Tool names stay globally unique, so registering
  per slot is safe.

## 8. Provider coexistence & Mastra-readiness (design intent / constraints)

Mastra and `claude-cli` coexist as peer entries in the provider registry; an agent picks
one by name. To keep them "living together cleanly," this spec must honour four rules:

1. **Seam = lowest common denominator.** The `Provider` seam knows only: history-carrying
   input → AG-UI event stream; pause = stop the stream at an approval; resume = a new run
   with full history. claude-cli quirks (stateless re-prime, detect-and-kill HITL) stay
   **inside** the claude-cli provider; Mastra's server sessions / native suspend-resume
   stay **inside** the Mastra provider. Neither leaks into the seam or `core/`.
2. **Both are permanent backends, not a stopgap.** `claude-cli` = "use your Claude Code
   subscription, no API key" (serves the git-clone-to-dashboard-in-an-hour north star).
   Mastra = production runtime (memory, multi-step tool loops, agent networks, any model
   via API key, server-side orchestration). Deployment chooses per agent.
3. **Tools shared via MCP** (see §6) — Mastra points its MCP client at the same stdio
   servers.
4. **Handoff converges on `core/handoff`** (see §5) — human click and (future) Mastra-native
   agent routing both express a surfaced handoff through one `encode/decodeHandoff`. Mastra
   is exactly the "future server-side router"; no rewrite needed.

Nothing Mastra-specific is built in this spec — these are constraints the build must not
violate.

## 9. Data flow (end-to-end, manual handoff)

1. Manager clicks START on the Qualifier card → real `claude`: `get_latest_email →
   renderVerdict{…}` → done. `VerdictCard` shows in the qualifier card/modal.
2. Manager clicks "Draft reply" → `handoff('reply', { threadId, from, subject, summary,
   category, priority })`: seed the reply run, launch it, open its modal.
3. Reply detects the seed → drafts from the payload context → `renderLead` → `saveDraft`
   (pause / approval).
4. Manager approves → resume (existing re-prime) → `create_draft` by `threadId` → done.
   The reply path is behaviourally unchanged from today.

## 10. Error handling

- Seed present but malformed (missing `threadId`/`from`) → reply emits a clear
  "handoff payload incomplete" error chunk, no crash.
- No seed → standalone path.
- Verdict missing `threadId` → no "Draft reply" button (gated on field presence).
- Handoff target id not in the registry → caught at wiring time, not at click.

## 11. Testing

- **core (TDD, pure/isomorphic):**
  - `decodeHandoff` / `encodeHandoff` round-trip; `decodeHandoff` → null when no seed;
    malformed payload handling.
  - reply `buildFirstPrompt(input)`: handoff branch vs standalone branch.
  - qualifier prompt strategy: first prompt calls `get_latest_email → renderVerdict`, no
    approval.
  - `buildAgent` resolves distinct prompt strategies for `qualifier` vs `reply` from one
    `claude-cli` factory.
  - `handoffs ⊆ registry ids` validation at wiring (error for an unknown target).
  - Existing 41+ tests stay green (reply behaviour unchanged).
- **client (light):** handoff payload assembly from `renderVerdict` args; "Draft reply"
  button gated on `threadId`.
- **browser (real account `sjuser95@gmail.com`):** START Qualifier → real verdict on the
  latest email → "Draft reply" → reply drafts → approve → real Gmail draft in the thread.

## 12. Deferred (explicitly not now)

Server-side orchestration/session; auto/agent-initiated handoff trigger; `defineWorkspace`;
`@platform/*` split; real Mastra provider; new Gmail tools; qualifier approval pause; the
polish backlog. These follow once the contract is validated on two agents.
