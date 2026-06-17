# Design — Instance Model (Agent / Instance / Run) + bidirectional ask

**Status:** design, agreed with the developer 2026-06-16. Supersedes the **identity half** of
`2026-06-16-lifecycle-unify.md` (the `lifecycle()` classifier, `settle()`, and pool-from-DB stay;
the `maxInstances`-as-singleton mechanism is replaced).

**Vocabulary (locked with the developer — use these exact words):**
- **Agent** = the card on screen. One per agent definition. Drawn once, always.
- **АИ** = the real model call (claude / gpt). One per Run.
- **Run** = one execution = a work item, served by one АИ.
- **Instance** = a group of Runs that share a correlation **key**.

---

## Problem

The lifecycle data was unified (`packages/core/src/lifecycle.ts`), but the **view derives identity a
second way**: it draws **one card per Run** (`boardModel.toPInstances` → one node per work item). So N
Runs of one agent render as N agent copies. That single conflation is the root of three live bugs:

- a **singleton shows two cards** (two Runs of one agent → two "instances");
- **duplicates after a server restart** (an orphaned Run + a new Run → two cards);
- the destructive **wipe-on-START + confirmation modal** (re-running would otherwise collide, so we
  wipe everything).

Industry separates a stable identity from its executions — Temporal **Workflow Id** (logical, one)
vs **Run Id** (per execution, many); OpenAI/LangGraph **thread** (one per conversation). We don't.
(See the deep-research comparative report, 2026-06-16.)

## Model — three levels

- **Agent (card)** — one per definition.
- **Instance** — a group of Runs sharing a **key**. The key IS identity.
- **Run (work item)** — one execution under an instance, one АИ.

## Keying (the key is a DISPATCH parameter — the caller sets it)

**The caller provides the key when it dispatches.** The agent definition declares **nothing** about
keying — this matches the industry (Temporal `workflowId`, OpenAI & LangGraph `thread_id` all come
from the caller at start, not from the definition). One rule:

> **same key → same instance; new key → new instance.**

```ts
dispatch({ agentId: 'reply', key: msg.from, ... })   // key = sender → one instance per sender
dispatch({ agentId: 'spam',  key: 'spam',   ... })   // constant key → one instance
```

- `reply` is dispatched with a **per-sender key** (`email.from`) → one instance per sender; two
  emails from one sender = one reply instance, two Runs (two drafts) under it.
- `spam` / `reader` are dispatched with a **constant key** → exactly one instance.

There is **no separate "singleton" concept** and **no `maxInstances` / `singleton` / `instanceKey` on
the agent**. "One spam instance" simply means the caller always passes the same key for spam —
nothing to declare, nothing to police. In our setup dispatch happens in essentially one place per
target (the sorter; the human START), so callers cannot disagree on the key — the inconsistent-caller
risk that would matter with many external callers does not apply here.

**`key` is its own column** (DECIDED) — it cannot be derived from the existing `source`. For `reply`
`source = email:{from}|{subject}` but `key = {from}` only (two emails from one sender, different
subjects → different `source`, SAME `key` → one instance, two Runs); for `spam` `key` is the constant
`'spam'` while `source` is the per-email id. They diverge in both directions → store `key` as a
dedicated work-item column, set at dispatch.

**`key` is REQUIRED at dispatch (DECIDED).** The framework just stores it and groups/dedups by it — it
has **NO default and NO notion of "singleton."** The caller ALWAYS passes a key: per-entity
(`reply` → `email.from`) or a constant for a one-instance agent (`spam`/`read`/`scan` → any stable
value; the agent's own `agentId` is a fine convention, NOT a framework rule). "Singleton" is therefore
not a framework concept — it is simply the caller passing a constant key. The framework stays a dumb
pipe: given a key, it groups by it; it never substitutes or decides one.

**Migration (dev, DECIDED):** reset the dev DB (data disposable, no prod yet), add the `key` column
(required, set at dispatch), new rows carry a key — no backfill needed.

**`maxInstances` — keep ONLY as a pure throttle + queue; sever the identity role (DECIDED).** A
concurrency bound IS needed: claude-cli spawns real subprocesses, so an unbounded batch → too many
processes + API rate-limit. So keep the worker-pool behavior exactly as today (`pool.enqueue`: N Runs
of an agent execute at once, overflow queues). **Remove every use of it as identity / singleton /
START-guard** (`isSingletonInput`, the `hasLiveScan` start-over confirm, occupancy-as-identity). After
this the number means strictly "max concurrent Runs," nothing about how many instances exist.

Example — throttle 4, 5 emails from 5 senders → 5 reply instances (one Run each); 4 Runs execute, the
5th **queues**; when one finishes (draft ready / awaiting approval) a slot frees and the 5th starts.
On screen: one reply card, 5 rows — 4 "Working", 1 "Queued".

Open detail (doesn't affect the model/UI): the limit can stay **per-agent** (as today) or become **one
global pool cap**. For bounding total claude-cli processes a single global cap is more direct
(per-agent doesn't bound the sum: 5 agents × 4 = 20 processes). Default per-agent now; global is a
drop-in if process pressure appears.

## Dedup by source

Every Run is stamped with its **`source`** (the email id). Before creating work for an email:
*"is there already a Run for this source?"* → yes: **skip**; no: **create**.

- `reply`: key = sender, source = the per-email delivery key — they DIFFER. Dedup (skip-if-covered)
  is by **source** (per email); the **instance** groups those Runs by sender. So a second email from
  a known sender = a new Run (new source) under the **existing** reply instance, not a skip.
- `spam`: constant key, so dedup is at the **Run level** by source (the one spam instance, one Run per
  distinct spam email).

What counts as "already handled" is the existing `lifecycle().covers` policy: a live or finished Run
covers (skip); an explicitly **rejected / cleared** one does not (re-surfaces on re-scan).

## START = safe re-scan (no wipe)

Re-pressing START = a **new scan**. Dedup-by-source means it re-processes only **new** emails;
already-handled ones land in their existing instance — no duplicate, nothing wiped. **Remove
wipe-on-START and the confirm modal as the default behavior.** "Clear everything" stays as a
**separate explicit button** (a confirm modal there is appropriate).

**The scan/input Run itself is a re-triggerable action, NOT idempotent-by-source (the key gap —
DECIDED).** Otherwise a `done` prior scan would be `covered` and re-START would skip it → no re-scan.
Resolution:
- A **human START always mints a NEW scan Run.** A `done` prior scan does **not** cover/block it —
  `covers`/dedup must not gate a human re-trigger of the input agent.
- The only gate is **one live scan per input instance at a time:** START while a scan is still running
  waits/queues (or focuses the existing) — never two concurrent scans. (`done` → re-runnable; `live`
  → sequential — the Temporal split: Reuse-on-closed = allow new; Conflict-on-open = one-open.)
- **Dedup-by-source applies only to the CHILD work** the scan dispatches (reply/spam per email), so
  re-scanning never re-creates already-handled emails.
- Net: the new scan Run + the old `done` scan Run both live under the **one** input instance (constant
  key) → one card; children dedup.
- **Show only the LATEST scan per input instance (DECIDED).** Otherwise N STARTs accumulate N done
  scans under the card. When a new scan Run starts, the instance's prior terminal scan Runs
  auto-retire via `settle('supersede')` (newer replaced older → hidden in Activity/history, I12, NOT
  deleted; `reset` is reserved for the explicit Clear — different audit meaning). Children (drafts)
  are independent and untouched, so the input card never grows.

**Who owns this rule: FRAMEWORK-owned (DECIDED).** It is dispatch semantics, not app logic, and keys
off the existing generic `origin` field on the work item (`'human' | 'agent' | 'inbound'`):
`origin='human'` (explicit START) → fresh Run, `covers` does not block; `origin='agent'` (machine
dispatch) → dedup by source. The rule spans both packages — the dispatch **chokepoint in
`@atizar/server`** consulting the **`covers` policy in `@atizar/core`** — hence "framework-owned," not
specifically core. Touching the dispatch contract ⇒ **`check-foundation` is mandatory** (I8). The APP
supplies only the DATA
— `key` and `source` at dispatch — never the re-trigger semantics (I5/I8: dispatch is framework-owned;
every workflow then gets safe re-scan for free).

**Not a blind `git revert`:** the just-added wipe-on-START + confirm modal (`e29e8e8`, `e758b71`) are
removed as the START behavior, but the **`wipeWorkflow`/`wipeAll` primitive those commits built STAYS**
— it backs the explicit "Clear" button. Keep the machinery, remove the START trigger + auto-confirm.

## Rendering

Card = **Agent** (one). Opening it → its Runs **grouped by instance**, never a picker of agent copies.
Results/answers = Run-result cards under their agent. Status (running / error) = a **badge on the
single agent card**.

## Restart (server)

State is already durable in Postgres; on restart we **re-derive live state** (boot / zombie sweep) —
that is our restart handling. We do **not** do Temporal-style exact mid-run replay: a killed
claude-cli Run errors or re-primes from scratch; Mastra can snapshot-resume. With keys, restart is
**visually clean**: an orphaned Run + a new Run collapse into the **one keyed instance** → one card.

## Bidirectional ask (NEXT pass — not this branch)

Orchestrator asks A **and** B, suspends, and wakes **when BOTH answer** — a **join** that extends the
return-channel docs' single ask→answer. Each answer = a Run-result card under A / B. Asking A twice =
one A instance, two sequential Runs. Asking the same question twice = dedup by source. New machinery:
a "waiting on answers" Run state + wake-when-all-answered, on top of the provider `resume` seam.

## Scope

- **Pass 1 (THIS branch `feat/instance-model`):** the three-level model — keying, dedup-by-source,
  view (card = agent, Runs grouped), START = safe re-scan, strip `maxInstances` of its identity role
  (keep it as a pure throttle + queue). **No protected-core surgery.** Fixes singleton-two /
  restart-dup / scary-modal.
- **Pass 2 (separate branch):** bidirectional ask (return channel + join) — touches the provider
  contract + transition graph; run `check-foundation` first. Build on the clean Pass-1 foundation.

## Where it lands (RE-VERIFY live before trusting — paths drift)

- **Keying + dedup:** `packages/server/src/dispatch.ts` — add `key` to `DispatchInput` (caller-set;
  the agent definition is NOT touched), group/identify instances by `key`; dedup-by-source partly
  exists via `lifecycle().covers`. `db/schema.ts` (`source` already on work items; add a dedicated
  `key` column — NOT derivable from `source`, per the Keying decision). Callers set the key: the
  sorter's dispatch to `reply`/`spam`, and the human START path.
- **View / identity:** `packages/react/src/boardModel.ts` (`toPInstances` — group by key, not per-Run),
  `pipelineModel.ts`, `hooks/useBoardNavigation.ts` (`openAgent` — never a picker for one agent),
  `aggregate.ts`, `lifecycleDisplay.ts` (the lossy `displayStatus`/aggregate that hides `stopped`).
- **START:** `pipelineService.ts` (drop wipe-on-START default; keep an explicit `wipe`/Clear),
  `hooks/useResetController.ts` + `useBoardNavigation.ts` (START → plain dispatch; Clear stays
  separate).

## Execution rules (per project conventions)

- TDD per unit; green gate before "done": `yarn typecheck && yarn test && yarn lint && yarn
  format:check` from repo root (+ `yarn workspace @atizar/react build` for any `@atizar/react` change).
- **Browser-verify every user-visible flow** (the `browser-verify` skill) — only the browser catches
  the view bugs this design targets.
- Run `check-foundation` if a change touches `@atizar/core`, providers, or the framework boundary.
