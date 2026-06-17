# Agent view & run/instance lifecycle presentation

**Status:** design, agreed with the developer 2026-06-17. Extends and **resolves the open decision**
in `docs/superpowers/specs/2026-06-17-live-ui-single-source.md` (§5 `error`). Same vocabulary
(Agent / Instance / Run / Gate), same server lifecycle model (`packages/core/src/lifecycle.ts`,
`packages/server/src/transition.ts`). Everything here is **framework-generic** unless explicitly
marked workflow policy (I5).

This doc answers one question the live-UI surfaces kept getting wrong: **once runs are
stopped/done/errored, what does the agent view show, and what can the user do?** It also records the
forward bindings (inter-agent wait, explicit-input agents) so the model is built to absorb them.

---

## 1. The model (unchanged base, stated precisely)

```
Agent (type)  ⊃  Instance (correlation, NO stored status)  ⊃  Run (= WorkItem, (phase,outcome))  ⊃  Gate
```

- **One source of truth = the Run's `(phase, outcome)`.** Everything else is a pure derivation.
- **One shared predicate `isLive(status)`.** No more three copies (`pipelineModel.ACTIVE`,
  `aggregate.BUSY`, the client `isVisible`-for-live filter). Define it once; ask it different
  questions per surface.
- **The unit of "live or not" is the INSTANCE, never an individual run.** An instance is live iff it
  has **≥1 live run**. A run is never hidden on its own.

### Two questions over the one `isLive`

| Surface | Question it asks | Why |
|---|---|---|
| **Pipeline** | `isLive(self) \|\| hasLiveDescendant` | it draws the tree — a finished parent must stay to host a live child (shown "Working") |
| **Card / picker / open-routing** | `isLive(self)` only | per-type, own instances; a live child shows in the CHILD's card, not the parent's |

`isLive` and `isBusy` are two questions over the same status (they differ **only on `error`**):
- `isLive` = `running \| awaiting_human \| (error AND not acknowledged)` → "shown in live UI".
- `isBusy` = `running \| awaiting_human` → the START slot gate (a crashed input agent still offers
  START to re-scan).

`hasLiveDescendant` already exists in `packages/core/src/lifecycle.ts` — reuse it; do **not** pull it
into the card question.

---

## 2. What the agent view IS

The agent card is the **agent TYPE surface**, and it **always exists** regardless of instance state:

1. **Description** — what the agent does.
2. **Settings** — (future) per-agent configuration.
3. **Live lens** — an overlay showing this agent's own live instances (count, status, drill-in).

Card persistence is a property of the **type**; liveness is an **overlay** on it. So "terminal
instances recede" and "the card is always there" do not conflict — the card stays, only the live
overlay reflects `isLive(self)` instances.

### Input vs worker agents — the real distinction behind "the sorter feels special"

- **Input / trigger agent** (e.g. the sorter; `role: input`, `entryAgentId`):
  - the persistent **root** — never torn down,
  - **START** is meaningful = "run / scan now" (mints a new run),
  - re-START applies the workflow `rerun` policy (sorter = `refresh` → supersede the prior scan),
  - its card shows the **last result as content** (e.g. INBOX SORTED) even when done — that is its
    "what the last run did + run again" state, not a live instance.
- **Worker agent** (reply / reader / spam / important; `role: worker`):
  - runs **only from a handoff**; START does not apply (footer = "Runs from a handoff"),
  - terminal instances **recede** (see §3); description/settings always present.

This is not a special-case in the lifecycle — it is the entry-point role. Build it as a role flag,
not as ad-hoc sorter logic.

---

## 3. Terminal handling — the core UX rule

The instance is the unit. A run is never individually hidden inside a thread.

- **done** — finished normally → the instance **recedes from the live lists** (pipeline node, card
  overlay, picker) once it has 0 live runs.
- **stopped** — user-initiated stop → same: **recedes**. Nothing is wrong, nothing to do.
- **rejected** — the human declined the proposed action → **recedes** like stopped (user decision,
  done with it). **Kept as a distinct outcome on purpose** — see §7: `rejected` does NOT `cover` its
  source, so a re-scan re-offers the email for a fresh draft (the only "retry" path given no restart).
  Folding it into `stopped` would make a rejected email permanently dead.
- **error** — failed unexpectedly → **STAYS visible** (needs attention) **until acknowledged**
  (§4). The one terminal exception. An oversight tool must not silently hide a crash.

**Color semantics (UX canon — user-terminal ≠ system-failure).** Only **`error`** is **red**
(danger/needs-attention). **`done` / `stopped` / `rejected`** are **neutral/grey** — they are
intentional endings, nothing broke. A red "Rejected" reads as a crash and is wrong; recolor it
neutral. (Current bug: `rejected`'s tint is the error/red tint in
`packages/react/src/lifecycleDisplay.ts` / `statusDisplay.ts`.)

"Recede" ≠ delete. The Run row stays in Postgres (freeze & keep) and in the board transport (still
needed for the pipeline tree walk and source dedup); it is only removed from the **live surfaces**.
There is **no history surface and no restart** — a receded done/stopped instance is simply not shown
again, and that is intended (nothing to do with it).

### The open instance thread (modal) is different from the live lists

- The modal shows **all runs of the instance inline as ONE thread** (`InstanceView`), **unfiltered**
  by liveness — including a done run (e.g. "draft saved"). This is the instance's own history while
  open.
- **No auto-close.** When the instance's last run goes terminal while the modal is open, the modal
  **stays** showing the final state; only the **Stop button disappears** (nothing live to stop). The
  user closes it themselves.
- Re-opening the agent later, with 0 live instances, lands on the **descriptive type-view** (START
  for input / "Runs from a handoff" for a worker). The transition to descriptive happens on the next
  open, never by yanking an open modal.

**Input agent — thread shows the LATEST scan only (not stacked history).** The input agent has a
**constant instance key**, so every scan run collapses into one instance, and `openRuns` (today)
renders **all** of them stacked — looking like `append`. The cause is deliberate: on re-START,
supersede of a prior finished scan is **skipped while that scan still has live descendants** (e.g.
reply drafts awaiting approval), because superseding a root the board filters would **orphan** those
children (`packages/server/src/pipelineService.ts:295-302`). So the older scans survive (kept to host
their live children) and pile up in the thread. Rule: the input agent's open thread renders **only
the latest scan's content**; older kept-for-children scans contribute their children to the **pipeline
tree / the child agents' cards**, not a repeated INBOX-SORTED card in the sorter thread. (Deeper,
cleaner option: **re-parent** live children onto the new scan on supersede — then the old scan is
always superseded, children preserved, no stacking at all. Quick path for the beta: thread = latest
scan.)

### Completion animation (the only pipeline change)

The pipeline is otherwise correct. The one addition: a live→terminal instance node **does not vanish
in the same frame**. A short **linger** (so the human reads the final state) then a smooth **fade**
out of the live lists. Client-side presentation only; the DB row is untouched.

The post-approval confirmation text (`onResume`, §5) is a **thread** event — seen by whoever
approved, because approval happens inside the open thread and the resume message streams into that
same thread. The pipeline node carries **status only**, never prose.

---

## 4. The `error` acknowledge action (new — symmetric with approve/reject)

approve/reject resolve a **gate** → the run flies to `done`/`rejected` and leaves the live UI. `error`
has no gate, so it needs its own dismissing action — an **"OK / Got it"** button, the error-analogue.

- **Server — new edge `acknowledge`** (sibling to the gate-resolution edges): `terminal/error` →
  terminal with the outcome moved **off `error`** (a `dismissed`/`reset`-class outcome).
- **Client — `isLive`** keeps only **unacknowledged** `error` among terminal outcomes. Once
  `acknowledge` moves the outcome off `error`, the instance **drops out of the live UI automatically**
  — exactly as an approved run flies to `done`. No separate "acknowledged" flag; the transition does
  it.
- **UI** — an "OK / Got it" affordance on an `error` run, rendered in the same slot as a gate's
  approve/reject.
- **Boundary** — the edge + button are framework-generic; any per-workflow wording is policy.

Symmetry: `approve/reject → done/rejected → leaves`; `OK → dismissed → leaves`. The **only** terminal
state that lingers in the live UI is an **unacknowledged `error`**.

Note: an **input-scan** error is retired by **re-START supersede** instead (a new scan supersedes the
errored root), so `acknowledge` is primarily for **worker** errors where there is no re-scan at that
level. Both paths move the outcome off `error`.

---

## 5. The resume seam — three modes (generalize `onResume`)

Today every approved gate spawns the model: `observer.resume()` → `consume(provider.resume(...))`,
and the resume prompt comes from the workflow's `onResume` (`PromptStrategy.buildResume`,
`apps/inbox/workflows/email-inbox/prompts.ts`). `done` is determined by the **resume run's stream
ending** → `consume` → `settle('finish')` (`packages/server/src/runObserver.ts:237`), regardless of
what `onResume` returned. A `null` `onResume` currently yields an ugly `"Resume failed"` chunk then
done (`packages/providers/src/claude-cli-provider.ts:127-129`).

Generalize the resume result to a discriminated union so an approval can resolve **without dragging
the model**:

- `{ kind: 'prompt', text }` → spawn the model (today's behavior; the agent emits a natural tail
  message, then `finish`).
- `{ kind: 'message', text }` → the **server appends the verbatim text** to the trace + `settle('finish')`,
  **no model spawn**. This is the **canned confirmation** ("Draft saved ✓") without an LLM round-trip.
- `null` → clean **silent** `settle('finish')` — no turn, and **no "Resume failed"** (also fixes the
  ugly current path).

- **Mechanism** (the three modes, the server resume path honoring them) is **framework** — a
  `PromptStrategy`/contract change in `@atizar/core` + `packages/server`.
- **Policy** (which mode, and the phrase) lives in the agent's `onResume` in the workflow
  `prompts.ts`.

So "after approval, does the agent speak / say a canned line / stay silent" is one knob: the agent's
`onResume` return shape.

---

## 6. Forward-compatibility (next iterations — additive, no contradictions)

### 6a. Inter-agent ask / wait / join

An orchestrator agent asks another agent (or two) and **sleeps** until the answer(s) arrive. The
structure absorbs this with three **additive** pieces:

- **Resume seam already generalizes.** HITL is "the agent slept at a gate → resume with
  `human approved`." Inter-agent is the same mechanism: "the orchestrator slept on sub-agents →
  resume with `agent X answered: …`." Generalize `buildResume` to take child results.
- **New LIVE phase `awaiting_agents`** (sibling of `awaiting_human`): a sleeping orchestrator is
  **live** (not active, not terminal), shown "Working", included by `isLive`.
- **Server join/barrier**: track the awaited children; wake the parent when all reach terminal (the
  "wait for two at once" case). New server logic over the existing parent→child links.

`hasLiveDescendant` already keeps the sleeping parent visible while children compute — it fits
directly.

### 6b. Explicit-input agents (e.g. paste GitHub ticket links)

An input agent that takes an explicit **input field** (paste one or many ticket links) instead of
auto-reading a mailbox. **Same mechanics as the sorter**, only the input is provided explicitly:

- N links pasted → **ONE input run** reads all N, classifies, dispatches N children (exactly
  "inbox of N → one scan → N dispatches"). A stream of links is one run, N dispatches.
- **Dedup by the link** — `source = ticket:owner/repo#id` (the analogue of `email:{messageId}`);
  re-pasting a handled link dedups (`covers`), no duplicate work.
- **Difference = the `rerun` policy.** The sorter is `refresh` (re-reads the live mailbox →
  supersede). An explicit-link input is more likely `append` (each START is **new work**, don't
  supersede prior). `rerun` is already a per-workflow knob (`descriptor.ts`).
- Still an **input/trigger** agent (persistent card, START, entry point) — just with an input field
  in its card instead of an auto-scan.

---

## 7. Decisions

- **Resolved — `live-ui-single-source.md` §5 (`error`): Option A**, extended. `error` stays in the
  live UI (`isLive` includes it; `isBusy` excludes it so START stays). Now refined: it stays only
  **until acknowledged** (§4).
- **Single `isLive`** replaces the three divergent sets; pipeline asks `isLive(self) ||
  hasLiveDescendant`, card/picker/open-routing ask `isLive(self)`; `openRuns` (the open thread) stays
  **unfiltered**.
- **No restart, no history surface.** done/stopped recede and are gone from the live UI; the only
  "history" kept is the input agent's **last result** on its persistent card.
- **No auto-close** of an open instance modal; Stop just disappears.
- **Keep `rejected` as a distinct outcome** (do not fold into `stopped`). It does NOT `cover` its
  source, so a re-scan re-offers the email for a fresh draft — the only retry path without restart.
  Fix is presentation only: recede like stopped + neutral color (not red).
- **Color**: red = `error` only; `done`/`stopped`/`rejected` are neutral.

### Open decisions to make explicitly when building 6b / the animation

- `rerun` policy for explicit-input agents → recommend **`append`**.
- ticket `source` format → **`ticket:owner/repo#id`**.
- animation flavor: linger duration; status marker ("Sent ✓") vs the agent's prose (prose only makes
  sense where the thread is open at approval time).

---

## 8. Boundary (I5)

Framework-generic: `isLive`/`isBusy`, the instance-recede rule, the `acknowledge` edge + button, the
three-mode resume seam, the `awaiting_agents` phase + join. Workflow policy (app): destinations,
labels, the per-agent `onResume` phrase/mode, the `rerun` value, the `source` format, the card
content. No `reply/reader/spam/important/email/ticket` literal ever enters `@atizar/*`.

---

## 9. Where it lands (RE-VERIFY before trusting — paths drift)

- **Single `isLive`** (new shared client module; TDD): replace `pipelineModel.ts` `ACTIVE`,
  `aggregate.ts` `BUSY`, and the client `isVisible`-for-live filter in `boardModel.ts` `toPInstances`.
- **Instance-recede**: filter heads to `isLive` in `useBoardNavigation.ts` (`instancesOf`/`liveOf`)
  → card + picker + open-routing show only live; leave `openRuns` unfiltered.
- **No auto-close / Stop hides**: `InstanceView` / `BoardInner` (`onStop` already filters to live runs).
- **Completion animation**: pipeline node/row component (linger + fade on live→terminal).
- **`acknowledge` edge**: `packages/server/src/transition.ts` (new `EdgeSpec`), `settle.ts`; the
  client `isLive` keys on `outcome === 'error'` so an off-`error` outcome auto-recedes; an "OK" button
  in the error-run render slot.
- **Three-mode resume**: `PromptStrategy`/`buildResume` contract in `@atizar/core`; the resume path
  in `packages/server/src/runObserver.ts:295-320` + `packages/providers/src/claude-cli-provider.ts:121-132`
  (honor `message`/`null` without spawning); the agent `onResume` in
  `apps/inbox/workflows/email-inbox/prompts.ts`.
- **Forward (6a/6b)**: `awaiting_agents` phase in `packages/core/src/lifecycle.ts` +
  `transition.ts`; join/barrier in the server dispatch/observer layer; `rerun`/`source`/input-field
  in the new workflow's descriptor — not yet built.

## 10. Execution rules

- One shared `isLive` first, TDD'd, then migrate each surface to it (kill the three local sets).
- Green gate before "done": `yarn typecheck && yarn test && yarn lint && yarn format:check` from repo
  root (+ `yarn workspace @atizar/react build` for any `@atizar/react` change).
- **Browser-verify every user-visible flow** (`browser-verify` skill): instance recede + completion
  animation, error stays then OK-dismisses, the open-modal-no-auto-close case, and each resume mode.
- Run **`check-foundation`** before landing — touches the lifecycle classifier, a new transition
  edge, and the provider resume contract (I8/I12/I14 boundary; the `acknowledge` edge + the
  `awaiting_agents` phase touch the locked I12 ladder → explicit confirmation before editing core).
