# Design — Dynamic agent instances

**Date:** 2026-06-08
**Status:** Approved (brainstorm), pending implementation plan
**Spec author:** session work with the user

## Problem

Today there is exactly **one** runtime copy of each agent per workflow, keyed
`instanceId(wf, agent)` = `wf__agent`. It is mounted idle for the whole session;
`deliver` overwrites its `messages` and re-runs it (`InboxView.tsx:62-65`). So when
the `reply` agent is busy on ticket #142 and a second ticket #143 is handed to it,
the second delivery **overwrites the first in-flight run** — there is no second copy.

We want: handing a second item to a busy agent spins up a **new instance** that runs
**concurrently**, up to a per-agent limit; overflow waits in a queue; the pipeline shows
the live instances; the right-hand "type" card aggregates them.

## Decisions (agreed with the user)

1. **Per-agent instance cap.** `defineAgent` gains `maxInstances` (default **2**,
   overridable per agent). A cap of **1** means "singleton" — there is no separate flag.
   `qualifier` (lead-inbox input) and `triage` (github-triage input) are set to **1**.
2. **Over the cap → queue.** Items beyond the cap wait and start automatically when a
   running copy finishes. The pipeline shows a plain text line under the agent, e.g.
   `в очереди: 2` ("queued: 2") — no per-item cards while waiting.
3. **Dynamic instances (Variant Б), via `registerProxiedAgent`.** The server keeps
   **one** agent per `wf__agent` (unchanged). The client creates a temporary proxied
   agent per live instance on demand, runs it immediately, and `unregister`s it when done.
   Live instance count tracks actual work — nothing exists at startup. Scales to a large
   catalog because unused agents create zero slots.
4. **Big "type" card aggregate.** The right-grid card shows `N активные · M ждёт
   одобрения` (active count + how many await approval). If none await approval, just
   `N активные`. Status word priority for any single-word display:
   `awaiting_approval > error > running > done > idle`.
5. **Instance label.** GitHub agents: `#142 · <title>` (number + ticket title, the title
   truncates with an ellipsis on one line; the status pill never gets pushed out).
   Lead-inbox agents: the sender, e.g. `maria@nordix.se`.
6. **Lifecycle.** A `done` instance disappears **immediately**. Exceptions:
   - a **workflow input agent** instance never disappears (it is the pipeline entry/root);
   - a **parent** stays visible (shown as Working) while it has a running subagent.
7. **Pipeline layout** (see also the memory `pipeline-instances-layout`):
   - `parent → arrow → bordered container` of everything that parent dispatched;
   - inside the container, **1 instance of an agent = one card**; **≥2 instances of the
     same agent = an agent mini-header (`N active`) + the instances nested under it with
     L-connectors**;
   - depth is **flattened to 2 and the parent is repeated**: if a dispatched instance
     itself dispatches agents, it appears AGAIN below as a new parent header → its own
     container. The same agent can appear multiple times. No deep nested tree.

## Architecture

### `@platform/core` — config

`AgentDefinitionSchema` gains:

```ts
maxInstances: z.number().int().positive().default(2)
```

So `def.maxInstances` is always a concrete number after `defineAgent(...)`. Set
`maxInstances: 1` on `qualifierAgent` and `triageAgent` in their descriptors.

No other core change is required for the runtime. (`instanceId` stays the server/runtime
key; a new local-id scheme lives client-side — see below.)

### Server — unchanged

`server/index.ts` keeps registering exactly one agent per `instanceId(wf, agent)`. The
provider is already stateless (fresh `claude` subprocess per run, no server session), so
concurrent runs of the same runtime agent on different threads do not share state. **No
lane pool, no `AgentsFactory`.**

### Client — the instance manager

A new client module (a hook/store, e.g. `useAgentInstances`) owns all live instances and
the queues. It replaces the fixed "mount one AgentRuntime per `wf__agent`" model for the
purpose of running work.

**Instance record:**

```ts
type Instance = {
  localId: string          // unique proxy id, e.g. `${runtimeKey}#${seq}`
  runtimeKey: string       // instanceId(wf, agent) — the server agent id
  workflowId: string
  agentId: string
  label: string            // "#142 · title" | "maria@nordix.se"
  parentLocalId?: string   // the instance that dispatched this one (pipeline tree)
  isInput: boolean         // input agent → never auto-removed
  agent: AbstractAgent     // from registerProxiedAgent
  unregister: () => void
  status: Status           // tracked via agent.subscribe (same logic as useAgentStatus)
}
```

**Per-runtimeKey queue:** `{ payload, label, parentLocalId }[]`.

**spawn(runtimeKey, payload, label, parentLocalId, isInput):**
1. Count live instances for `runtimeKey`. If `< maxInstances(agent)`:
   - `const { agent, unregister } = copilotkit.registerProxiedAgent({ agentId: localId, runtimeAgentId: runtimeKey })`
   - `agent.messages = [encodeHandoff(payload)]` (or the input-agent's empty seed for a user "Start")
   - subscribe for status; `void copilotkit.runAgent({ agent })`
   - push the `Instance` into state.
2. Else (cap reached): push `{ payload, label, parentLocalId }` onto the queue.

**On status → `done`:** if the instance is **not** an input agent and has **no** live
children → `unregister()` + remove from state, then **drain**: if the queue for that
`runtimeKey` is non-empty, dequeue one and `spawn` it (a slot just freed). Input-agent
instances and parents-with-live-children are kept.

**deliver** (the existing seam, `InboxView.tsx`) becomes a thin wrapper that resolves the
destination (unchanged `resolveDelivery`) to a `runtimeKey` + `targetWorkflow`, derives the
label from the payload, derives `parentLocalId` from the source agent's live instance
(today every dispatcher is a cap-1 input agent, so its single live instance is the parent),
and calls `spawn(...)`. Cross-workflow delivery keeps the **background-run + badge + no
auto-switch** behavior; only the spawn mechanism changes.

> **Follow-up (not now):** when a `maxInstances ≥ 2` agent itself gains `handoffs`, the
> source instance is ambiguous from the workflow id alone. Resolve it by injecting the
> source `localId` into the per-instance prompt (same mechanism as the existing `origin`
> param) so the handoff carries its parent. Current descriptors have handoffs only on the
> cap-1 input agents, so this is deferred.

**Input agents & "Start".** The big "type" cards (right grid) always render from the agent
*definitions* (no live instance needed) and own the "Start" button for `role: 'input'`
agents. Pressing Start `spawn`s an input instance (cap 1; an empty seed, the agent reads
the inbox/board itself). That instance is `isInput: true` → stays after `done`.

### Pipeline rendering

Replace the agent-level `activePipeline` (in `pipeline.ts`) with an **instance-tree** builder.

Input: the live `Instance[]` for the active workflow + the per-agent queue counts.

Build & render:
1. **Roots** = input-agent instances (always shown, even idle/done) + any live instance
   whose parent is not shown.
2. A non-input instance is **shown** if it is active (`running | awaiting_approval | error`)
   or is an ancestor of a shown instance (parent kept as Working while a child runs) — the
   existing ancestor fixpoint, now over instances.
3. **Emit depth-2 blocks, repeating parents:** for every shown instance that has ≥1 shown
   child, emit a block: `parent header → arrow → container`. Inside the container, group the
   children **by `agentId`**:
   - group of 1 → a single instance card;
   - group of ≥2 → an agent mini-header (`N active`) + the instances nested with L-connectors.
   If a child is itself a parent of shown instances, it also heads its own block below
   (hence "repeat the parent").
4. Under an agent group, if that agent has queued items, render the `в очереди: N` line.

The builder is a **pure function** (instances + queues → render model) so it is unit-testable
without React. `PipelineColumn.tsx` renders the model with the styles validated in the visual
companion (`.superpowers/brainstorm/.../pipeline-v3.html`).

### Big "type" card aggregate

For each agent in the active workflow, compute over its live instances:
`activeCount`, `awaitingCount`, and the priority status word. `AgentCard` shows
`N активные · M ждёт одобрения` (or `N активные`, or idle/Start when none). This is derived
state in `InboxView`; `status.ts` union is unchanged.

## Edge cases

- **Re-deliver the same item** while a copy is already on it: out of scope to dedupe; a new
  instance starts (the human chose to route it again). Can add a dedupe key later.
- **Queue + workflow switch:** queues are per `runtimeKey`, independent of the active view;
  switching workflows does not drop queued items (consistent with state-persists-across-switch).
- **All copies error:** errored instances are "active" (need attention) and stay shown; they
  do not free a slot until the human acts (re-run or dismiss). Cap could deadlock if every
  copy errors and the human ignores them — acceptable; the queue line shows the backlog.
- **unregister timing:** unregister only after the run is finalized to avoid tearing down a
  live subscription mid-stream.

## Out of scope (this pass)

- Manager/Admin role toggle and the notifications bell (later visual fixes — user will
  describe separately).
- Multi-instance *dispatcher* source-lane prompt injection (deferred per above).
- Dedupe of repeated deliveries.
- Per-instance result history beyond what the agent card already shows.

## Testing strategy

- **core:** `maxInstances` default + override; `defineAgent` parse.
- **instance manager:** pure routing helper — `spawn` respects cap (creates vs enqueues),
  `done` drains the queue, input/parent kept. Test the reducer/store logic without CopilotKit
  (inject a fake `registerProxiedAgent`/`runAgent`).
- **pipeline builder:** pure-function tests — single vs nested grouping, depth-2 repeat,
  input always shown, ancestor kept, queue line.
- **Browser E2E (required — see memory `always-run-browser-e2e`):** real github board /
  real Gmail. Route ticket #1 to reply → 1 copy; route #2 → 2 copies side by side; route #3
  → `в очереди: 1`; let #1 finish → #3 starts automatically; verify big-card aggregate text;
  verify long-title truncation; verify input agent stays after done; verify no stuck "Running".

## Files touched (anticipated)

- `packages/core/src/defineAgent.ts` — `maxInstances`.
- `apps/inbox/workflows/{github-triage,lead-inbox}/descriptor.ts` — `maxInstances: 1` on the
  two input agents.
- `apps/inbox/client/src/` — new `useAgentInstances` (manager + queue), rewrite of
  `pipeline.ts` (instance-tree builder), `PipelineColumn.tsx` (new render + styles),
  `InboxView.tsx` (deliver → spawn, big-card aggregate, drop fixed all-mounted-idle),
  `components/AgentCard.tsx` (aggregate text). `AgentRuntime.tsx`/`useAgentStatus.ts` reused
  for status subscription (possibly folded into the manager).
- Docs: `CLAUDE.md` (instances model + `maxInstances` knob + proxied-agent mechanism),
  `HANDOFF.md` (status), `docs/BUILD-LOG.md` (§ when built).
```
