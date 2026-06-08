# Workflow separation — design

**Date:** 2026-06-08
**Status:** approved (direction), spec under review
**Supersedes context:** HANDOFF.md → "PLANNED NEXT — workflow separation"

## Problem

Today a "workflow" is not a thing — it is a *filter over one shared everything*:

- **Server** (`server/index.ts`): one `CopilotRuntime` with all 6 agents registered flat in a
  single `agents: {}` map, plus per-agent tool allow-lists inlined as module constants.
- **Client** (`InboxView.tsx`): one shared view that mounts **every** workflow's render tools
  globally and unconditionally (`useInboxActions()` + `useGithubActions()` both always run,
  relying on globally-unique tool names), then filters which agents to display by the active tab.
- **Registry** (`workflows.ts`): a flat `workflows[]` array + one shared `META` map keyed by id.

Adding a 3rd workflow means editing the *bodies* of three shared files. There is no isolation
boundary: agents of inactive workflows are unmounted on switch (state lost), and the same agent
cannot be reused across workflows as independent copies.

## Goal

Make a workflow a **self-contained, isolated module**. Concretely:

1. **Reuse-as-copies.** The same agent definition can be placed in N workflows; each placement is
   an independent instance with its own conversation/state. (User's words: "один работник, но
   отдельные копии — workflow это изолированные штуки.")
2. **A safe cross-workflow door.** A workflow cannot push a payload directly into another
   workflow's internal worker. Each workflow declares **inputs** (an input agent + an accepted
   payload shape); cross-workflow delivery can only target a declared input.
3. **User-driven navigation only.** The system never switches the active workflow and never
   auto-opens an agent. Delivery *runs* the target in the background (same as today's intra-workflow
   handoff) but surfaces a **button + badge**; the human switches when they choose.
4. **Add a workflow without editing shared file bodies** — add a folder + one line per layer
   aggregator.

Non-goals (deferred — see "Scope & deferred"): URL routing per workflow; per-workflow CopilotKit
contexts (full render-tool isolation); a live demo that actually reuses one agent across two
workflows.

## Key concepts (plain terms)

- **Box** = workflow. **Worker** = agent. **Parcel** = handoff payload. **Door** = a workflow's
  declared input.
- **Mounted / idle** = the agent's invisible `<AgentRuntime>` is in the React tree, so its
  `useAgent` handle exists and it *can* be run — but it is doing nothing and spending no tokens
  until `runAgent` is called. **Running** = a model call is in flight.

## Design

### 1. Agent roles: `input` vs `worker`

Role is a property of an agent's **placement in a workflow**, not of the agent definition (the same
agent could be an input in one box and a worker in another). It is carried on the workflow's agent
entry, not on `AgentDefinition`.

- **`input`** — an entry point. The user can **Start** it (the current Start button). It is the
  only role that can be a cross-workflow delivery target.
- **`worker`** — internal. No Start button. Reachable **only** via an intra-workflow handoff from
  another agent in the same box. This is the safety boundary: nothing outside a box can address a
  worker.

Role subsumes today's `canStart` / `handoffTargets` derivation in `InboxView`.

Mapping the current app: `qualifier` = input, `reply` = worker; `triage` = input,
`feature`/`bugfix`/`reply-draft` = workers.

### 2. The cross-workflow door — published contracts (Variant 1)

A workflow **publishes a list of named, typed inputs** — its *contract*. Each input is
`{ name, schema, agentId }` where `agentId` is the **private** binding to the input agent that
receives it. The contract's public face is only `{ name, schema }`: other workflows see "workflow B
accepts a parcel of shape X under the name `lead`" and **never see which agent handles it**.

- A source addresses a destination by **contract** — `{ workflow, input }` — never by the target's
  agent id. The source may know that workflow B exists and publishes input `lead` of shape X (it
  sees the contract); it may not reach into B's agents.
- An incoming parcel is validated against the named input's `schema` before it is allowed through
  ("проверка формы"). A mismatched shape or an unknown input name is rejected.
- The bound input agent is the box's receptionist: it receives the parcel and routes internally
  using the existing intra-workflow handoff seam (`handoff.ts`). Outside callers never see the box's
  internals.

An input agent that is **not** bound to any published contract is still user-startable (Start
button) but cannot receive cross-workflow deliveries.

(Deferred: Variant 2 — fully type-matched discovery where the source emits a typed parcel and the
shell offers every workflow whose contract matches, without the source naming any workflow. Variant
1 is what we build now.)

### 3. Delivery: runs immediately, never navigates

One unified shell-level seam replaces the current `requestHandoff`. It takes a **destination** and a
payload, plus the `origin` workflow the click came from (see §5 for how `origin` is known):

```ts
type Destination =
  | { kind: 'agent'; agentId: string }                       // intra-workflow worker
  | { kind: 'contract'; workflow: string; input: string }    // another workflow's published input

deliver(origin: string, dest: Destination, payload: unknown)
```

- **Intra-workflow** (`kind: 'agent'`): resolve `instanceId(origin, agentId)`, seed its messages
  (`encodeHandoff`), `runAgent`. **Change from today:** do *not* `setOpenId` — no auto-open. The
  "delivered to X" note already renders in the source thread; the user opens the target by clicking
  its card.
- **Cross-workflow** (`kind: 'contract'`): look up `workflow`'s published input by `input` name;
  validate `payload` against its `schema`; reject (structural error to the author, not a runtime
  crash — see §7) if the input is unknown or the shape mismatches. On success: resolve to
  `instanceId(workflow, <private bound agentId>)`, seed + `runAgent` it **in the background**, do
  **not** switch the active workflow, and raise (a) a badge on the target workflow's switcher tab
  and (b) an "Open in <workflow>" button in the source's generative UI / thread. The human clicks to
  switch and open.

Because all input agents are always mounted (§4), the target handle always exists at delivery time
— there is no mount-then-run race (the reason "waking" a worker was rejected).

### 4. Runtime: all workflows mounted idle (Variant A)

At app start the shell mounts an invisible `<AgentRuntime>` for **every** workflow × agent, keyed by
**instance id**, and keeps them mounted for the session. The active-workflow state only selects
which *view* renders. Switching workflows is a pure view swap — instant, and conversations persist.

Idle agents are cheap (a hook + a handle object; zero tokens). We explicitly reject lazy/wake-on-
demand mounting (Variant B) — it reintroduces the async mount-then-run race for no real saving at
this scale. We also reject per-workflow CopilotKit contexts (Variant C) — maximal isolation but the
highest "only-the-browser-catches-it" risk, against our documented CopilotKit gotchas. One shared
`<CopilotKit>` context stays.

The `handles` map (today workflow-scoped, cleared on switch) becomes **global**, keyed by instance
id, accumulating every mounted agent. `deliver` resolves targets from this map.

### 5. Instance namespacing (what makes reuse-as-copies work)

Within one CopilotKit context, `useAgent({ agentId })` keys the live agent object by `agentId`. Two
placements of the same agent must therefore use **distinct ids** or they collide into one shared
conversation. So every placement gets an **instance id**:

```
instanceId(workflowId, agentId)  ->  `${workflowId}__${agentId}`
```

- Client: `<AgentRuntime>` and `useAgent` use the instance id.
- Server: the runtime registers each placement **under its instance id** (built from the same
  definition + prompts + tools). Since the provider is stateless re-prime (no server session), two
  instances of the same agent run independently. The server's flat map is replaced by an iteration
  over the workflow registry: for each workflow, for each agent placement, register
  `instanceId → buildAgent(def, prompts, registry, allowedTools)`.
- Intra-workflow handoff targets resolve to `instanceId(origin, def.handoffs[i])`.
- Cross-workflow delivery targets `instanceId(targetWorkflow, <private bound agentId>)`.

**Render tools must know which copy emitted the click (done properly, not deferred).** A render
callback receives only `{ name, toolCallId, parameters, status, result }` — **not** the emitting
agent id (confirmed in `docs/copilotkit-notes.md`). And a render tool registers **once per global
tool name** (registering the same name twice would collide), so a single shared closure draws the
cards of *every* copy of a reused agent. To let that closure route a handoff to the **correct**
copy, the emitting workflow id travels **in the tool parameters** as an `origin` field:

- The per-instance prompt injects the origin — the same mechanism `ticket.prompts.ts` already uses
  to inject `renderTool`/`kind`. The agent reliably echoes a constant we hand it ("when you call
  `render_triage`, set `origin` to `"github-triage"`"). This does not depend on any CopilotKit
  internal exposing the agent id.
- Render specs are declared as **data** by each workflow module; the client shell collects them and
  registers each **unique** tool name **once**, with a closure that reads `parameters.origin` and
  calls `deliver(origin, dest, payload)`. Reused agents share that one registration; `origin`
  disambiguates the copy. This makes reuse of handoff-emitting agents work fully — no deferral.

### 6. Module structure

A workflow becomes a folder `apps/inbox/workflows/<id>/` with three files, one per bundle boundary
(core/server/client cannot share one import graph — server is Node, client is React):

- **`descriptor.ts`** (imports `@platform/core` only — pure data): `id`, `label`, `iconName`, agent
  placements `{ agent, role }[]`, `entryAgentId`, and the published `inputs` contract
  `{ name, schema, agentId }[]`. Validated by `defineWorkflow` (§7).
- **`server.ts`** (Node): per-agent `prompts` factory + `allowedTools` (the `mcp__…` allow-lists,
  moved out of `server/index.ts`). The prompts factory injects each agent's `origin` (its
  workflow id) for handoff-emitting render tools (§5).
- **`client.tsx`** (React): render specs as **data** (`{ toolName, parameters, component, kind }`
  where `kind` is `'render' | 'handoff' | 'approval'`), `META` chrome, and an **optional** `view`
  component override (default: the shared two-panel view). The shell registers each unique
  `toolName` once (§5).

Three thin aggregators collect them: `workflows/index.ts` (descriptors, core),
`server/workflows.ts`, `client/src/workflows.ts`. **Adding a workflow = add the folder + one line in
each aggregator** — no edits to shared file bodies. The existing `inbox.agent.ts` /`github.agent.ts`
agent definitions move under their workflow folders.

### 7. Validation: `defineWorkflow`

Mirrors `defineAgent`'s structure-only philosophy (pure, zod, no React/Node):

- `entryAgentId` is a `role:'input'` agent in this workflow.
- Every agent's `handoffs` resolve to agents **within the same workflow** (cross-workflow links go
  through published contracts only, never `handoffs`).
- Every published input's `agentId` is a `role:'input'` agent in this workflow.
- Published input `name`s are unique within the workflow.
- No duplicate agent ids within a workflow.

Cross-workflow delivery legality (the destination contract exists and the payload matches its
`schema`) is enforced by the shell's `deliver` against the registry — a structural guard, since only
a human can trigger delivery (the model has no tool for it).

## Data shapes (sketch)

```ts
type AgentRole = 'input' | 'worker'

type WorkflowAgent = {
  agent: AgentDefinition
  role: AgentRole
}

// A published contract entry: public face is { name, schema }; agentId is the
// private binding to the input agent that receives this parcel.
type WorkflowInput = {
  name: string
  schema: z.ZodTypeAny
  agentId: string             // must be a role:'input' agent in this workflow
}

type WorkflowDescriptor = {
  id: string
  label: string
  iconName: IconName
  agents: WorkflowAgent[]
  entryAgentId: string        // must be a role:'input' agent
  inputs: WorkflowInput[]     // published contract (may be empty)
}

type Destination =
  | { kind: 'agent'; agentId: string }
  | { kind: 'contract'; workflow: string; input: string }
```

## Behavior changes summary (user-visible)

| Action                          | Today                                  | After |
|---------------------------------|----------------------------------------|-------|
| Agent A hands to agent B (same box) | seeds + runs B, **auto-opens** B's modal | seeds + runs B; **no auto-open**; user clicks B's card |
| Switch workflow                 | unmounts old agents, state lost        | pure view swap; state persists |
| Cross-workflow delivery         | not possible                           | addressed by contract `{workflow, input}`; runs target input agent in background; badge + button; **no auto-switch** |
| Reuse one agent in two workflows| not possible                           | independent copies (instance ids); handoff-emitting cards routed by `origin` param — works fully |

## Testing

- **Unit:** `defineWorkflow` validation (each rule above, happy + each failure); `instanceId`;
  `deliver` resolution — intra (`kind:'agent'` → `instanceId(origin, agentId)`), cross-allowed
  (`kind:'contract'` → resolves the private bound agent), cross-rejected (unknown input name /
  payload fails the contract `schema`); `origin`-based routing picks the correct copy when an agent
  is placed in two workflows. Keep the existing 103 tests green; migrate `handoff` tests as needed.
- **Browser E2E (mandatory — per project rule, always run the full pipeline):**
  1. Lead inbox: start qualifier → it hands to reply → confirm reply **does not** auto-open; open
     it manually; approve a draft (Gmail flow intact, never sends).
  2. GitHub triage on the real board (read-only): triage → route a ticket to feature/bugfix/
     reply-draft intra-workflow; confirm no auto-open. Confirm comment count unchanged (read-only).
  3. Cross-workflow: trigger a delivery from one box to another box's declared input; confirm the
     target runs in the background, the active view does **not** switch, the badge + button appear,
     and clicking the button switches + opens the input agent.
  4. Switch workflows back and forth; confirm conversations persist.
- **Stale dev server:** kill prior `tsx/vite/concurrently`, free `:4000`/`:5173`, confirm the boot
  log is from this run before driving the browser (per CLAUDE.md).

## Scope & deferred

- **In scope:** roles, the published-contract cross-workflow door + `deliver`, all-mounted runtime,
  instance namespacing, `origin`-routed handoff cards (full reuse of handoff-emitting agents),
  module structure, `defineWorkflow`, the two behavior changes (no auto-open, no auto-switch +
  badge/button), migrate the two existing workflows, browser E2E.
- **Deferred:** URL routing per workflow; per-workflow CopilotKit contexts; Variant 2 type-matched
  contract discovery; a third demo workflow that exercises reuse live. Reuse-as-copies is fully
  built and unit-tested this pass; a live reuse demo is optional.
- **Hard constraint unchanged:** GitHub stays strictly read-only; nothing here adds a GitHub write
  path.
