# Pipeline model — Workflow / Agent / WorkItem / Case

How work lives and moves through the pipeline. This is the **entity model and
communication contract** the rest of the pipeline is built on. It is derived from belief #1
("the human conducts only what they can see" — see `docs/ARCHITECTURE.md`).

Read this to understand *what the entities are, how they relate, what data they pass, and what
each is allowed to know*. Implementation details (which file, which function) are intentionally
left out — a fresh agent should read this, understand the model, and work out the code itself.

> Why this exists: three recurring gaps (P1/P2/P3, below) were treated as isolated bugs but are
> really one missing model — the **durable unit of work** and the **ephemeral compute that
> produces it** were conflated. Naming the entities precisely makes the gaps dissolve by
> construction instead of being patched.

## Entities

| Entity | What it is | Lifetime |
| --- | --- | --- |
| **Source** | The external thing being processed (email, GitHub issue, lead) — an **identity / address**, not data. Stream-level (inbox, board) for readers; item-level (one email, one issue) for workers. Today's `deliveryKey`. | External |
| **WorkItem** (node) | The **durable unit of work** the human acts on. Holds status, result, gates, trace. **Pinned to its owning agent — it does not migrate** (see "Work does not flow"). | Durable (survives run teardown within the session) |
| **Run** | An **ephemeral compute segment**: an agent runs `running` → emits/asks → detaches. With claude-cli a run is killed at the approval tool call and re-primed on resume, so one WorkItem crossing several gates = several runs. | Ephemeral |
| **Executor** | The live `claude` / proxied-agent process attached to a WorkItem **while it is `running`**. Not stored. | Attached only while running |
| **Gate** | A first-class **sub-record of a WorkItem**: one discrete human decision (approve / choose / rate). Own id, `open`/`resolved` status, form data. | Lives on its WorkItem |
| **Case** | A **view** (not a stored object): the chain of WorkItems sharing an item-level `source`, walked by `parent`. | Computed on demand |
| **Agent** | The `defineAgent` descriptor (provider, tools, approvals, renders, role, `maxInstances`). Exactly one per `wf__agent`. | Whole session |
| **Workflow** | An isolated module that groups agents and publishes an `inputs` contract. | Whole session |

### WorkItem shape

```
WorkItem {
  id
  agentId      // owner: which agent produced it (wf__agent). The node is pinned here; it does not migrate.
  source       // identity of the external thing (deliveryKey): gh:#5 / an email Message-ID / board:8
  parentId?    // node it came from; null = human-started (case root)
  origin?      // thin label "where it came from" (parent / other workflow / human)
  status       // running | awaiting_approval | awaiting_input | result | finished | error | closed
  gates[]      // first-class sub-records: decision points (open/resolved + form data)
  result?      // card data (verdict / plan / draft / list)
  trace        // AG-UI events (audit, journal seed)
  createdAt, closedAt?
}
```

## Run ≠ WorkItem; WorkItem birth is an event

A **Run** is ephemeral compute; a **WorkItem** is the durable unit. The count between them is
**not 1:1**:

- `reply`: 1 run → 1 WorkItem (looks 1:1, but that is the special case);
- `triage`: 1 run → 1 WorkItem (the list); per-ticket WorkItems are born **when the human
  routes** rows;
- `chat` (future): 1 long run → **0..N** WorkItems over the conversation.

**Load-bearing rule (do not break this — a future chat agent depends on it):**

> A WorkItem is born when an agent **calls a render- or handoff-tool** (emits a durable card /
> hands work off). WorkItem birth is **NOT tied to run start** — the birth point is the
> tool-call, not the start of the run.

Consequences: WorkItem lifecycle is **decoupled** from run lifecycle (one run → many WorkItems;
one WorkItem → many runs). A resume run (after approval) **continues** the existing WorkItem — it
does not create a new one; the final text is an outcome marker, not a new unit. "1 run → 1
WorkItem" must not be hard-coded.

## Work does not flow — nodes are pinned, lineage is the flow

A WorkItem **does not move between agents**. It is pinned to the agent that produced it
(`agentId`) for its whole life. What "flows" is the **payload** (a typed slice) at the moment of
routing/handoff, which **seeds a new child WorkItem** owned by the next agent, linked back by
`parentId`. So "work moving down the pipeline" is a **chain of parent-linked nodes (lineage)**,
not one traveling object.

```
WorkItem(feature #5)            owned by feature — stays put
   │  human routes / agent hands off:
   │     payload = slice,  origin = this node
   ▼
[ reply — run ] receives { source, payload, origin }
   │  calls a render tool
   ▼
WorkItem(reply #5)  NEW          owned by reply, parentId = feature #5
```

## Lifecycle

Active ("needs me"): `running`, `awaiting_approval`, `awaiting_input` (chat — waiting for a
free-text reply; sibling of `awaiting_approval`), `result`, `error`.
Terminal ("done"): `finished` (succeeded, visible, reopenable), `closed` (archived).

```
[*] --> running                      (human started / approved / routed)
running --> awaiting_approval         (stopped at an approval)
running --> awaiting_input            (chat: waiting for a reply)
running --> result                    (drew a card)
running --> finished                  (empty leaf: no card AND no children)
running --> error
awaiting_approval --> running         (approved → a new executor attaches)
awaiting_approval --> finished        (rejected)
result --> finished                   (human done with the card / auto-finish upward)
error --> running                     (retry)
error --> finished                    (dropped)
finished --> closed                   (archive)
finished --> running                  (reopen: new work appeared beneath it)
closed --> [*]
```

**Result signal** (how to tell a real result from an empty finish), checked at finalize:
1. errored → `error`;
2. stopped at an approval → `awaiting_approval`;
3. **called at least one registered render tool (a card)** → `result`;
4. else (text only / data read) → does NOT vanish, goes to `finished`.

"Called a card" is read from `defineAgent.renders` (it already lists the card tools — no new
config). This also keeps the UX rule "a result is a card, not a wall of text."

**Pipeline = board of active nodes.** Only active nodes show; `finished`/`closed` leave for
"Done" (**record intact** — not deletion). **Upward auto-finish:** a node goes `finished` when
**(a)** all its children are `finished`/`closed` **and (b)** its own card has no open actions
(a single-action card satisfies (b) on action; a multi-action card like a triage list only when
every row is routed or dismissed). **Reopen** if new active work appears beneath it. No downward
death cascade — a child's finish notifies the parent; the parent decides.

## Gates and the conversation shape

Inside one WorkItem the human touches work at **touchpoints**, of two kinds:

- **Gate** — a discrete decision; a first-class sub-record (own id, `open`/`resolved`, form
  data), **not** a disappearing render.
- **Conversation turn** — an open free-text reply (chat agent; future).

A **chain of forms from one agent over one source is ONE WorkItem with N gates**, not several
WorkItems. Example: `reply` emits draft `[Send]` → "add e-mail to contacts? Yes" → "rate the
work ★". The lifecycle loops `awaiting_approval ↔ running` across the gates; `finished` only when
the **last** gate is resolved and no open actions remain. Resolved gates settle as ✓ steps in the
card (history is kept).

**Boundary "new gate vs new WorkItem":**
- a new form from the **same agent over the same source** → **a new gate on the same WorkItem**;
- work going to **another agent** (deliver / handoff) → **a new (child) WorkItem**.

**Chat agent (deferred, model ready):** `reply` handing a message to a chat agent is a **separate
child WorkItem** (different agent → new WorkItem). Between turns it sits in `awaiting_input`. It
may **mint a WorkItem mid-conversation** (the same render-tool birth rule). Mechanically a chat is
the most native shape for our stack — everything underneath is already a thread; "agents with
gates" are the constrained case.

## Two axes: ownership vs lineage

Containment is **two orthogonal axes**, and one WorkItem lives in both:

- **Ownership (static, code):** Workflow ⊇ Agents; an Agent **owns** its WorkItems (`agentId`); a
  WorkItem **contains** its Gates + trace. Does not cross workflow boundaries. This is where
  encapsulation (belief #3) lives.
- **Lineage (dynamic, runtime):** WorkItem →`parentId`→ WorkItem, following `source`. **Case is a
  view over this axis** and deliberately crosses workflow boundaries.

Fields encode the split: `agentId` = ownership; `parentId` + `source` = lineage. (Analog:
OpenTelemetry — a span *belongs to* a service but `trace_id` *correlates* across services.)

## Agent input = one envelope, whoever called

A run starts with a **self-contained typed envelope** and does **not** branch on "who called me":

```
input = { source, payload, origin }
```

The same shape regardless of trigger — human start / route from parent / cross-box delivery /
resume-after-approval. It does **not** receive other agents' internals, the full Case by default,
or the parent's trace; history is fetched explicitly by a tool when needed. (Like an actor
receiving a message, or a function receiving args — decoupled from the caller.)

## `source` vs `payload`

- **payload** answers "**what to do**": data to work with, a snapshot from the parent, per-node,
  changing, large. For the **agent**.
- **source** answers "**what this is about and whether we touched it**": a stable identity/address,
  shared by all nodes about one item, small key. For the **system**.

Analogy: source = URL / tracking number (identity); payload = downloaded content. **Content ≠
identity.** Three jobs only `source` can do: (1) dedup / "already handled?" (→ the P3 fix),
(2) grouping into a Case, (3) freshness / re-fetch / write-back (payload is a route-time
snapshot).

**Granularity:** a reader's source = a stream (`board:8` / `inbox:support`), payload empty — the
reader fetches the stream itself and produces one list WorkItem; a worker's source = one item
(`gh:#5`), payload = that item's slice. The **stream → item** narrowing happens at human routing:
the parent narrows `source` and slices the routed row into the child's `payload`. The reader
(stream) node is **not** a member of an item's Case — it is the common ancestor/entry. A Case is
glued by `parent` + item-`source`, not by a shared `source` key.

**Deriving source:** take the external system's **natural id** (`gh:#5`; email → RFC 5322
Message-ID; lead → CRM id; stream → container id). No natural id → a deterministic hash of
**stable** fields only. At a box boundary → a new key in the receiver's namespace embedding the
origin (`feedback:from:gh:#5`), deterministic so re-delivery dedups. The key must be
**deterministic from the external thing** or dedup breaks. Computed at the **edge** (the
integration adapter that knows the external id) and stamped on the node at birth. This is today's
`deliveryKey`.

## Node → node handoff

The handoff `payload` is a **typed slice**, not "everything": a child sees the parent's slice by
default, not the whole chain (full history via the Case view on demand). Delivery is marked
**per-destination, explicitly**: one-time vs repeatable — instead of implicit key dedup.

## Workflow boundary = a new source is born

Workflows are isolated boxes. Handing work to another workflow is **NOT** carrying the same source
across — it **mints a new source on the other side** (like forwarding an email → a new ticket in
the target system).

**Only two things cross the boundary:**
- a **typed payload** through the receiving workflow's published `inputs` contract (declared
  fields only, translated into its terms);
- a **thin origin reference** back: `{ originWorkflow, originSource, originWorkItem }` — labels/ids,
  not live objects.

The born entity knows its payload + an origin label (for display "from: mail / Bob's email" and
audit). It **cannot** reach the foreign box's agents, other nodes, or trace. **Knowing a label ≠
having access.** Symmetry: the sending side shows a badge + "Open in `<wf>`" (forward link); the
receiving side carries the origin reference (back link). A Case is therefore per-box; the
cross-box thread is reconstructable via the thin links **on demand**, not by default.

## Case = view, not object

A Case is a **view** (query: nodes with this item-`source` + `parent` lineage), not a stored
object. A case has no state of its own — it is exactly what its nodes are. A light "close case"
action = close all its nodes. Promote to an object only when case-level state is needed (assignee,
priority, multi-source merge) or a DB arrives.

## Who knows what (the encapsulation boundary)

| Entity | Knows | Does NOT know / cannot |
| --- | --- | --- |
| **Agent** | its tools; its `{source, payload, origin}`; its declared destinations | other agents' internals; full history by default (fetches on demand); who called it "from inside" |
| **WorkItem** | its `agentId` (owner), `source`, `parentId`, its gates, its result/trace | other nodes — only its parent; not sibling branches |
| **Case** | — (it is a **view**) | computed from nodes by source + parent |
| **Workflow** | its agents; its published `inputs` contract | other workflows' internals — only their contract (name, schema, target agent) |
| **Cross-workflow** | only a typed parcel + a thin origin label crosses | the foreign box's agents, nodes, trace; cannot invoke anything there |

Each entity knows the minimum for its own work and nothing of others' internals; coupling is
always through a declared contract (the agent's envelope, the workflow's `inputs`, a node's
parent/source), never by reaching inside a neighbour. **The framework/userland boundary is the
knowledge boundary** (belief #3).

## The three gaps this model fixes

- **P1** — a worker's result vanishes when its run finalizes. Fix: a WorkItem is durable and is
  not torn down with its executor; an empty finish goes to `finished`, a render call to
  `result` — neither disappears.
- **P2** — an idle agent shows a "running" intro. Fix: no `running` node → no running intro; idle
  agents render a static description.
- **P3** — a used one-time button stays active. Fix: "already acted" = a child WorkItem with this
  `source` exists; the row reads its children and shows "→ sent ↗".

## Honesty / open items

- "Durable" today = survives teardown **within the session** (React memory), **not** a page
  reload. True persistence = a DB (deferred; the `trace` field is its seed).
- **Close policy** (`finished → closed`): auto-archive by age / on next run, or manual only — TBD.
- **AI↔AI** (two agents conversing without a human): two WorkItems delivering to each other turns
  the lineage tree into a graph (cycles possible). Flagged and deferred.

## Not doing now

Chat agents, AI↔AI, a DB / cross-reload persistence, a Case object, type-matched cross-workflow
discovery, a "peek" preview of a delivered result. The model is shaped so each can be added later
without breaking it.

## Market conventions referenced

Temporal (Completed persists; signals inside one execution), BPMN/Camunda (waiting-for-human is a
first-class state; message → separate process instance + correlation), Zendesk (Solved vs Closed;
CSAT is part of the same ticket), Linear/Jira (Done is visible), XState/statecharts (`onDone`, no
death cascade), Erlang/Akka actors (message-passing input), Kafka (key vs value = source vs
payload), Stripe (idempotency key), OpenTelemetry (span ownership vs trace correlation), DDD
bounded contexts + Anti-Corruption Layer.
