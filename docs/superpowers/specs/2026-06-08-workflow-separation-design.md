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

### 2. The cross-workflow door

An input agent **may** additionally declare `accepts: ZodSchema` — the parcel shape it will receive
from *other* workflows.

- Input agent **without** `accepts` → user-startable, but no other workflow may deliver to it.
- Input agent **with** `accepts` → also a valid cross-workflow delivery target; an incoming parcel
  is validated against `accepts` before it is allowed through ("проверка формы").

The input agent is the box's receptionist: it receives the parcel and routes internally using the
existing intra-workflow handoff seam (`handoff.ts`). Outside callers never see the box's internals.

### 3. Delivery: runs immediately, never navigates

One unified shell-level seam replaces the current `requestHandoff`:

```
deliver(target: { workflow?: string; agentId: string }, payload: unknown)
```

- **Intra-workflow** (`workflow` omitted): resolve the target instance handle within the active
  workflow, seed its messages (`encodeHandoff`), `runAgent`. **Change from today:** do *not*
  `setOpenId(targetId)` — no auto-open. The "delivered to X" note already renders in the source
  thread; the user opens the target agent by clicking its card.
- **Cross-workflow** (`workflow` given): the target must be a `role:'input'` agent of that workflow
  with an `accepts` schema that the payload satisfies; otherwise the call is rejected (structural
  error surfaced to the workflow author, not a runtime crash — see validation). On success: seed +
  `runAgent` the target input agent **in the background**, do **not** switch the active workflow,
  and raise (a) a badge on the target workflow's switcher tab and (b) a "Open in <workflow>" button
  in the source's generative UI / thread. The human clicks to switch and open.

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
- Intra-workflow handoff targets resolve to `instanceId(thisWorkflow, def.handoffs[i])`.
- Cross-workflow delivery targets `instanceId(targetWorkflow, targetInputAgentId)`.

**Known limitation (documented, in scope to flag — not to fully solve this pass):** render tools
register by **global tool name** with a single captured closure. An agent whose render tool *emits
a handoff* (e.g. `render_triage`'s route button) cannot yet be reused across workflows, because the
one registered closure can't know which instance emitted the click. Reuse of agents that do **not**
emit handoffs from their render tool (pure readers/workers) works. Full reuse of handoff-emitting
agents needs the instance id threaded through the tool result — deferred. The existing two
workflows have disjoint agents, so this pass is not blocked by it.

### 6. Module structure

A workflow becomes a folder `apps/inbox/workflows/<id>/` with three files, one per bundle boundary
(core/server/client cannot share one import graph — server is Node, client is React):

- **`descriptor.ts`** (imports `@platform/core` only — pure data): `id`, `label`, `iconName`, agent
  placements `{ agent, role, accepts? }[]`, `entryAgentId`. Validated by `defineWorkflow` (§7).
- **`server.ts`** (Node): per-agent `prompts` factory + `allowedTools` (the `mcp__…` allow-lists,
  moved out of `server/index.ts`).
- **`client.tsx`** (React): render-tool registrations (today's `useXActions`), `META` chrome, and
  an **optional** `view` component override (default: the shared two-panel view).

Three thin aggregators collect them: `workflows/index.ts` (descriptors, core),
`server/workflows.ts`, `client/src/workflows.ts`. **Adding a workflow = add the folder + one line in
each aggregator** — no edits to shared file bodies. The existing `inbox.agent.ts` /`github.agent.ts`
agent definitions move under their workflow folders.

### 7. Validation: `defineWorkflow`

Mirrors `defineAgent`'s structure-only philosophy (pure, zod, no React/Node):

- `entryAgentId` is a `role:'input'` agent in this workflow.
- Every agent's `handoffs` resolve to agents **within the same workflow** (cross-workflow links go
  through declared inputs only, never `handoffs`).
- `accepts` only appears on `role:'input'` agents.
- No duplicate agent ids within a workflow.

Cross-workflow delivery legality (target is an input with a matching `accepts`) is enforced by the
shell's `deliver` against the registry — a structural guard, since only a human can trigger delivery
(the model has no tool for it).

## Data shapes (sketch)

```ts
type AgentRole = 'input' | 'worker'

type WorkflowAgent = {
  agent: AgentDefinition
  role: AgentRole
  accepts?: z.ZodTypeAny      // input-only; presence = cross-workflow deliverable
}

type WorkflowDescriptor = {
  id: string
  label: string
  iconName: IconName
  agents: WorkflowAgent[]
  entryAgentId: string        // must be a role:'input' agent
}
```

## Behavior changes summary (user-visible)

| Action                          | Today                                  | After |
|---------------------------------|----------------------------------------|-------|
| Agent A hands to agent B (same box) | seeds + runs B, **auto-opens** B's modal | seeds + runs B; **no auto-open**; user clicks B's card |
| Switch workflow                 | unmounts old agents, state lost        | pure view swap; state persists |
| Cross-workflow delivery         | not possible                           | runs target input agent in background; badge + button; **no auto-switch** |
| Reuse one agent in two workflows| not possible                           | independent copies (instance ids) — except handoff-emitting render tools (deferred) |

## Testing

- **Unit:** `defineWorkflow` validation (each rule above, happy + each failure); `instanceId`;
  `deliver` target resolution (intra, cross-allowed, cross-rejected on bad shape / non-input
  target). Keep the existing 103 tests green; migrate `handoff` tests as needed.
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

- **In scope:** roles, the cross-workflow door + `deliver`, all-mounted runtime, instance
  namespacing, module structure, `defineWorkflow`, the two behavior changes (no auto-open, no
  auto-switch + badge/button), migrate the two existing workflows, browser E2E.
- **Deferred:** URL routing per workflow; per-workflow CopilotKit contexts; full reuse of
  handoff-emitting agents (render-tool instance awareness); a third demo workflow that exercises
  reuse live. Reuse-as-copies is *architecturally supported and unit-tested* this pass; a live
  reuse demo is optional.
- **Hard constraint unchanged:** GitHub stays strictly read-only; nothing here adds a GitHub write
  path.
