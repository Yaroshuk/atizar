# Live-UI single source of truth — problem, model, open decision

**Status:** in progress. Two commits landed on `feat/handoff-trace-and-scan-result`; one design
decision remains (the `error` fork in §5) before the final refactor.

This doc is a HANDOFF: it states the problem, the model we converged on, what's already done, and
the one open decision — so a fresh agent can continue without re-deriving it.

---

## 1. The entities (the model — pure data, no visuals)

```
Agent  ⊃  Instance              ⊃  Run (= WorkItem)        ⊃  Gate
type      identity = (agentId,key)   one email → one draft      pending approval on a Run
```

- **Agent** — the type (reply, sorter…). `agentId`. Static name/icon/intro live in `config.meta`.
- **Instance** — a correlation of an agent, keyed by `(agentId, key)`. `key` is app policy
  (`apps/inbox/server/index.ts` `instanceKeyOf`: reply→sender). An instance has **no stored
  status**; it derives from its runs.
- **Run** — one unit of work = one WorkItem (server/DB row). Has the real status.
- **Gate** — a Run's pending approval (the draft + Approve/Reject).

**One source of truth = the Run's STATUS.** Everything else is a derivation:
- Run status: `displayStatus(phase, outcome)` (`packages/react/src/lifecycleDisplay.ts`).
- Instance status: `pickHead(runs)` — worst-meaningful by `PRIORITY` (`pipelineModel.ts`).
- Agent (card) status: `aggregateAgent(instances)` (`aggregate.ts`).

`isLive`, `isBusy`, `isVisible` etc. are NOT extra sources — they are **questions asked OF the one
status** (pure functions). (One birthdate → many questions: "adult?", "can vote?".)

---

## 2. The problem (what the user hit)

The live UI surfaces disagree about **what counts as "live"** because that question is computed in
THREE different places with different sets:

| Place | "live/active" set | error? | feeds |
|---|---|---|---|
| `pipelineModel.ts` `ACTIVE` | `running, awaiting_approval, error` | **in** | pipeline column |
| `aggregate.ts` `BUSY` | `running, awaiting_approval` | **out** | card "N active" + START gate |
| `boardModel.ts` `toPInstances` → core `lifecycle().isVisible` | keeps done/stopped (I12 ladder) | n/a | `pInstances` → picker, card aggregate, instance modal, pipeline input |

Symptoms (all the same root):
- **Agent CARD shows "Stopped"** and the **picker lists stopped instances** — because the card
  aggregate + picker run over `instancesOf` → `pInstances` (kept by `isVisible`, which keeps
  done/stopped). The user's words: "карточка spam пишет Stopped непонятно зачем". **The pipeline
  is FINE** (it narrows via its own `ACTIVE`/`shown`); the bug is the card + picker.
- The 1-vs-2 count mismatch (card counted raw runs vs pipeline counted instances) — **already
  fixed**, see §4.

Root cause: **"what's live" is not single-sourced** — three copies. Fix = one `isLive(status)`
used by pipeline + cards + picker; delete `ACTIVE`/`BUSY`/the client `isVisible`-for-live filter.

---

## 3. The agreed display rule (where children come in)

Two base facts, each single-source: (1) each Run's **status**, (2) the **parent/child tree**
(`WorkItem.parentId`). Derivations:

- `isLive(status)` — one definition (the open `error` question is §5).
- `hasLiveDescendant` — already in `@atizar/core` (`lifecycle.ts`): a pure walk over (statuses +
  tree). Reuses the SAME "live" notion on descendants.

Rules:
- **Pipeline** shows a node if `isLive(self) || hasLiveDescendant`. A done sorter with a live reply
  child stays, labelled "Working" — that "Working" comes from `hasLiveDescendant`.
- **Cards / picker** count an agent's own live instances: `isLive(self)` (no children — the tree-keep
  is a pipeline concern).
- `done / stopped / rejected` with no live child → shown NOWHERE in the live UI.

Note: the modal of an OPEN instance (`useBoardNavigation.openRuns`) intentionally shows ALL of that
instance's runs (incl. a done one — "draft saved") — that is the instance's thread, separate from
the live-UI "what shows" question. Don't filter `openRuns` to live.

---

## 4. What's already done (committed)

- **`1ee0208`** `fix(react): agent-card count derives from instances, not raw runs (single source)`
  — `aggOf` now aggregates `instancesOf` (one head per `(agentId,key)`), not raw work-items;
  `entriesOf` removed. Fixes "pipeline says 1 active, card says 2".
- **`d65ba06`** `feat(react): instance opens as ONE thread of inline run messages; pipeline rows
  are instances` —
  - `InstanceView` (new): one Instance = ONE scrollable thread + ONE header (name + instance
    status + run count) + ONE intro bubble + instance-level Stop. No count-based modal branching.
  - `RunView` (new): one Run = just its inline MESSAGES (received-from, text/tool cards, gate). NO
    frame/agent-name/status-pill/per-run Stop.
  - `ThreadItems` (extracted from `AgentModal`) renders the message stream without its own scroll
    container; `ThreadBody` wraps it for the idle type-view; `IntroBubble` = single intro markup.
    `AgentModal` is now only type-view chrome. **`ThreadModal` deleted** (its role = `RunView`).
  - `useGateNode` (new): the ONE place a Run's approval becomes a card (`useGate` + injected HITL
    spec). Resolving one run leaves siblings open.
  - `PipelineColumn`: one row per INSTANCE + `· N` run-count badge; flat-vs-grouped depends only on
    **instance** count (not run count).
  - `ThreadItems` skips the wrapper when `renderToolCall` returns null → no empty `threadItem` div
    consuming the flex `gap` (the phantom blank space, see §6 dev-mode note). TDD'd in
    `ThreadItems.test.tsx`.

Build is green at `d65ba06`: `yarn typecheck`, `yarn lint`, `yarn test` (624 tests). Browser-verified
the InstanceView one-thread render (one header, intro once, runs inline, no boxes).

---

## 5. THE OPEN DECISION — what to do with `error` (blocks the final refactor)

To make the live-UI rule literally ONE function, the only thing in the way is `error`. In the card
(`AgentCard.tsx`), START shows only when `activeCount === 0`, where active = `BUSY` (excludes error)
— deliberately, so a CRASHED input agent still shows START (re-scan). So "shown in live UI" and
"blocks START" diverge **only on error**.

- **Option A (recommended): `error` STAYS in the live UI** (needs-attention; an oversight tool must
  not hide crashes). Then two one-line questions over the one status: `isLive` (incl error, for
  "shown") and `isBusy` (excl error, for the START gate). Differ only on error. No behavior change.
- **Option B: `error` LEAVES the live UI** like done/stopped (recover via re-scan/START anyway).
  Then literally ONE rule `live = running|awaiting`, `isBusy` not needed; but a crashed run vanishes
  from the live column (surface it via a badge/history instead).

**Decide A or B first.** Then the refactor:
1. Define `isLive(status)` once (and `isBusy(status)` if A) — a small shared client module; TDD it.
2. Pipeline: replace local `ACTIVE` with `isLive` (same set as A); keep `isLive(self) ||
   hasLiveDescendant`. Refactor `view()`/`shown` to call it.
3. `instancesOf` (`useBoardNavigation.ts`): filter to instances whose head `isLive` → card + picker
   + openAgent-routing show only live (fixes "Stopped" card + stopped-in-picker). Leave `openRuns`
   unfiltered.
4. `aggregate.ts`: `activeCount` uses `isBusy` (A) — unchanged behavior, just shared/renamed.
5. Delete the now-dead `ACTIVE`/`BUSY` local sets.

Server `lifecycle()` (`isLive`/`isVisible`/`covers`) and `hasLiveDescendant` stay — that's a
DIFFERENT layer (cancel-cascade, dedup, board membership / retired-on-board), not a competing source
for the client live-UI. Do NOT touch server lifecycle for this.

---

## 6. Secondary open items (smaller, can fold in)

- **`hasCard` inside core `isVisible`** (`lifecycle.ts`): a terminal item is "visible" iff
  `hasCard || human-terminal || hasLiveDescendant`. The user questioned coupling UI-content
  (did a card render?) into the lifecycle predicate. Candidate cleanup: make board membership a
  pure lifecycle question; let the client live-UI rule (§3/§5) decide what shows live. **Touches the
  locked I12 ladder → needs explicit confirmation before editing core.**
- **`stopped` freeze-and-keep vs retire**: the locked decision is "STOP = freeze & keep" (stopped
  Run stays on the board). With the §5 fix, stopped is `isVisible` but NOT `isLive` → it's gone from
  live surfaces WITHOUT changing stop semantics. So **no server change needed** — the client `isLive`
  filter is enough. (Earlier "retire on stop" idea is superseded by this; don't pursue it.)
- **dev-mode raw chip**: dev mode (`localStorage['aiw.dev'] === '1'`, PERSISTS across navigations —
  the URL need not carry `?dev=1`) includes ALL tool calls in the thread. Card-less tools (e.g.
  `route_emails`) render `null`. The §4 null-skip removes the phantom gap, but dev mode no longer
  shows a raw chip for those tools. If a dev raw-chip is wanted, add a fallback renderer for
  card-less tools in dev mode (separate, optional).

---

## 7. Key file map

- `packages/core/src/lifecycle.ts` — `lifecycle()` (isLive/isVisible/covers), `hasLiveDescendant`.
- `packages/react/src/lifecycleDisplay.ts` — `displayStatus(phase,outcome) → Status`.
- `packages/react/src/aggregate.ts` — `PRIORITY`, `BUSY`, `pickHead` reuse, `aggregateAgent`.
- `packages/react/src/pipelineModel.ts` — `ACTIVE`, `shown`/`view()`, `pickHead`, `buildPipeline`.
- `packages/react/src/boardModel.ts` — `toPInstances` (filters by `isVisible`), `queuedByAgent`.
- `packages/react/src/hooks/useBoardNavigation.ts` — `instancesOf`, `liveOf`, `openRuns`/`openHead`,
  `openAgent` routing.
- `packages/react/src/components/{InstanceView,RunView,AgentModal,PipelineColumn,InstancePickerModal}`.
- `apps/inbox/client/src/BoardApp/BoardInner.tsx` — wires `aggOf`, `InstanceView`, pipeline.
- `apps/inbox/server/index.ts` — `instanceKeyOf` (reply→sender), `sourceOf` (dedup by messageId).
