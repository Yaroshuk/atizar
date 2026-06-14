# Brief — Workflow Re-run Semantics: Deep Comparative Analysis

**Status:** analysis brief (authored 2026-06-14). This is NOT a design or a plan — it is the
self-contained handoff for a FRESH agent to produce a deep, well-explained comparative analysis,
after which the user (Sergey) decides the direction. Branch: `analysis/workflow-rerun-semantics`.

**Your deliverable as the next agent:** one analysis document
(`docs/superpowers/specs/2026-06-14-workflow-rerun-semantics-analysis.md`) — see "Your task" below.
**Do NOT implement anything. Do NOT change product code. Analysis only.**

---

## 1. Why this exists (the trigger)

The user opened the app and saw **two** `EMAIL SORTER · Working` rows (and two `LEAD QUALIFIER ·
Working` in another workflow) in the left "Pipeline" column at once, and asked *why*. Digging in
surfaced that this is not a display bug to patch — it is an **unspecified product question**:

> **Can you run the same workflow twice, and what should happen when you do?**

The user explicitly wants: **not a quick fix**. They want a **deep, multi-application comparative
analysis** — how do other real products handle "running a pipeline/automation again" — and then
**our options laid out in plain language**, so we can decide. The answer might be uniform across our
workflows, or per-workflow. We'll decide after the analysis.

**Tone requirement (hard):** explanations must be **clear and understandable, not a pile of jargon**.
Write for a smart person who doesn't live in this codebase. Define terms when you use them.

---

## 2. What "running a workflow" actually IS here (grounded facts — respect these)

This framework is a **thin, human-oriented control layer over agent runtimes** — it orchestrates and
displays; it is not an engine. Default focus: **inbound flows** (email / leads / GitHub tickets →
qualify → human approval → action). Read `docs/PHILOSOPHY.md` and `docs/ARCHITECTURE.md` §0 (the three
beliefs + invariants I1–I15) before writing — the re-run model must not violate them. Especially:

- **Belief #1 / I1:** the human starts, steers, approves at every meaningful step. The **human START
  is the central gesture**. No autonomous mode; no schedule (machine dispatch is allowed, a machine
  *action* never — I2).
- **The durable unit is the WORK ITEM, not the instance (I12).** A work item lives, shows its result,
  waits for a human, and closes only when the human closes it. The thing that runs the agent is an
  ephemeral *instance*.
- **I8:** server-authoritative state in Postgres; one `transition()` owns every status change.

A **workflow** = one or more **input agents** + **worker agents** (see
`apps/inbox/workflows/{lead-inbox,email-inbox,github-triage}/descriptor.ts`). The human clicks **START**
on an input agent. Crucially, in the current beta the input agent **reads a live source itself** — the
Gmail inbox or the GitHub board — with **no per-item payload** on a human START (payload `{}`, source
`null`). So "run the workflow" today literally means **"scan the whole inbox/board now."** There is no
"run on THIS specific lead" entry from the board (that path exists only as a cross-workflow *handoff*).

### Precise current behavior (verified in code — quote/cite these in the analysis)

`packages/server/src/dispatch.ts` is the ONE chokepoint. Today:

1. **Human START → `source: null` → dedup is SKIPPED** (`if (input.source)` guards it). So **every
   START mints a brand-new root work item.** Nothing stops a second, third, … scan. This is why the
   rows accumulate.
2. **Child dispatch (handoff / `deliver` onto a specific email/ticket) carries a `source`** (e.g.
   `thread:https://github.com/.../issues/5197`). The dedup then finds any **live-or-finished** work
   item with the same source and returns it (`deduped: true`) — so **the same email/ticket is not
   processed twice** (per-item idempotency). A `rejected` or `error` item is NOT deduped (it offers an
   explicit re-run). [There is a known robustness nuance: a *finished* same-source item also dedups,
   so a stale finished scan can shadow a fresh one — analyze this.]
3. **Concurrency / singletons:** all three current input agents — `qualifier`, `triage`, `sorter` —
   are `maxInstances: 1` (the `defineAgent` default is 2). The dispatch has a
   `rejected: 'already_running'` path: a second **concurrent** human START of a singleton input is
   refused. So two input runs *at the same time* are already prevented; a second START while one runs
   queues/rejects. The user's "two at once" are **two sequential finished runs**, not two concurrent.
4. **Input-agent roots are KEPT in the pipeline forever** after they finish
   (`packages/react/src/boardModel.ts` → `isVisible`: an input agent is always visible; it's the
   "pipeline root"). So each START leaves a permanent row → accumulation.
5. **Display quirk (downstream, fold into the analysis — do NOT fix standalone):**
   `packages/react/src/pipelineModel.ts` → `buildPipeline` has
   `view = (x) => ACTIVE.has(x.status) ? x : { ...x, status: 'running' }` — it force-relabels every
   kept-but-not-active instance to `running` → the pill reads **"Working"**. So a *finished* input
   root shows "Working" in the pipeline even though the agent's big card (which uses the aggregate,
   `aggregate.ts`) correctly shows "Done". The intent was "a parent with a still-live child shows
   Working", but it also mislabels finished roots that have no live child.

### Ground truth observed (DB), for context
After a DB reset + a few STARTs, `work_items` held two `sorter` ROOTs and two `qualifier` ROOTs, all
`status = finished` — i.e. genuinely separate runs from separate START clicks, all done, both shown
"Working". (Children: a `reply` finished, a `reader` rejected.)

---

## 3. The question, decomposed (what the analysis must answer)

State each clearly and answer each:

1. **Concurrency.** Two runs of the same workflow *at once* — allowed, blocked, or queued? (Today:
   singleton input ⇒ blocked/queued. Is that right? Should some workflows allow parallel scans?)
2. **Sequentiality.** Run *again after finish* — is it a brand-new run, a **refresh that supersedes**
   the previous scan, or a **no-op when nothing changed**? (Today: always a new accumulating root.)
3. **Item-level idempotency.** A re-scan finds the same un-actioned email/ticket — re-surface it,
   skip it as "already seen", or merge into the existing work item? (Today: dedup-by-source skips
   live/finished same-source children — analyze the stale-finished-shadow nuance.)
4. **Presentation.** How repeated runs should appear in the pipeline column (accumulate / supersede /
   "Done" + history drawer / collapse-into-one). Tie in the "Working" mislabel fix here.
5. **Uniform vs per-workflow.** Should lead-inbox, email-inbox, github-triage all behave identically,
   or differ? Consider a *future* "process THIS specific lead/ticket" workflow that takes an explicit
   input payload — its re-run semantics differ from an inbox-*scan* workflow. Does the framework need
   ONE model or a per-workflow knob (e.g. a descriptor field like `rerun: 'refresh' | 'history' |
   'once'`)?

---

## 4. Your task (next agent) — use subagents (superpowers:dispatching-parallel-agents)

Produce ONE analysis document. Recommended shape:

**(A) Comparative research — fan out parallel subagents, one per product domain.** For each, answer:
how is a "run" modeled? can you re-run / refresh? what gets deduped (idempotency keys, dedup windows)?
is it "latest snapshot" or "immutable run history"? how is it shown in the UI? Cite concrete,
verifiable product behavior — if you're unsure of a detail, say so rather than inventing it (use
WebSearch/WebFetch). Domains to cover (add others if relevant):
   - **Email / inbox automation & triage:** Gmail filters/rules, Superhuman, Missive, Front, HEY,
     SaneBox — what "re-run rules on existing mail" / "refresh" means; how repeated processing is
     shown and deduped.
   - **Automation platforms:** Zapier, n8n, Make (Integromat), Pipedream — the *runs/executions*
     model, manual re-run, **replay**, idempotency/dedup keys, run history UI, "only trigger on new
     items."
   - **Job / workflow engines:** GitHub Actions, GitLab CI, Temporal, Airflow, Dagster, Prefect —
     run vs schedule vs manual trigger; re-run/retry; idempotency; dedup windows; "latest run" vs full
     history; backfill.
   - **Agent / LLM orchestration:** LangGraph + LangSmith runs, OpenAI Assistants (threads vs runs),
     CrewAI, Temporal-for-agents — run vs thread vs conversation; what "run again" does.
   - **Ticketing / triage:** Linear/Jira automations, GitHub triage bots — re-triage semantics, "don't
     re-act on the same issue."

**(B) Synthesize patterns.** Name the recurring models in plain language, e.g.: "latest snapshot /
refresh" vs "immutable run history" vs "idempotency-key dedup" vs "trigger-on-new-only" vs "replay a
past run." Explain the trade-off each makes (clarity vs auditability vs duplicate-work risk).

**(C) Map to OUR options.** For each candidate model, give: a **plain-language description of what the
manager experiences**, how it maps onto our pieces (the `dispatch` chokepoint + `source` dedup, the
work-item-as-unit, the kept input root, the pipeline column, singletons), **pros/cons**, the
**high-level code changes** it implies (which files: `dispatch.ts`, `boardModel.ts`/`pipelineModel.ts`,
maybe a `defineWorkflow` descriptor field, `transition.ts`), and **invariant fit** (I1/I2/I8/I12).
Fold the "Working"-label fix into whichever options need it. Candidate starting set (expand from
research):
   - **Refresh / supersede:** one current scan per workflow; a new START re-scans and replaces the
     prior scan in the pipeline (old run kept in history/trace, not cluttering). Inbox mental model.
   - **Immutable run history:** each START is a distinct durable run; finished ones move to a
     "Done"/history drawer (the beta inventory already names a `DoneDrawer`). Job-runner mental model.
   - **Trigger-on-new-only / block-if-nothing-changed:** a re-START is a no-op (with a hint) unless the
     source has genuinely new, un-actioned items.
   - (Any hybrid the research surfaces.)

**(D) Uniform vs per-workflow** — answer #5 above explicitly; recommend whether to hard-code one model
or add a per-workflow descriptor knob, and why.

**(E) Recommendation.** Lead with a reasoned recommendation (the user prefers a recommendation over a
neutral menu), then present the decision points clearly so the user can choose. End the doc with a
short, explicit "Decisions needed from you" list.

**Doc structure:** start with a 1-paragraph **executive summary** a busy reader can grasp, then the
sections above. Keep it readable — short paragraphs, concrete examples, minimal jargon (define what
you must use). Commit it to this branch.

---

## 5. Constraints / don'ts

- **Analysis only — no product code changes, no plan, no implementation.** (The next step after the
  user picks a direction will be its own brainstorm → spec → plan.)
- **Do NOT fix the "Working" label or the accumulation standalone** — they're downstream of the model
  the user chooses; cover them inside the analysis.
- Subagents: **read-only research** (WebSearch/WebFetch fine); **must not switch git branches**; verify
  product claims, don't hallucinate behavior (say "unverified" if unsure).
- Plain language. The user has repeatedly asked for clear explanations over term-dumps.
- The user works autonomously and delegates: do the full analysis without pausing for approval at each
  sub-step; surface the decision points at the END.

## 6. Pointers (read these first)
- `docs/PHILOSOPHY.md` (beliefs + conscious "no"s) and `docs/ARCHITECTURE.md` §0 (I1–I15).
- `packages/server/src/dispatch.ts` (the chokepoint — dedup, source, depth, singleton reject),
  `transition.ts`, `workerPool.ts`.
- `packages/react/src/boardModel.ts` (`isVisible`, `toPInstances`), `pipelineModel.ts`
  (`buildPipeline`, the `view()` relabel), `aggregate.ts`, `status.ts`/`statusDisplay.ts`.
- `apps/inbox/workflows/*/descriptor.ts` (input vs worker roles, `maxInstances: 1`).
- `docs/pipeline-updated-3.md` (the locked build spec — dispatch §1.8, transition §1.2).
- `HANDOFF.md` (where the project is). Frontend overhaul (WS1–WS3) is DONE & merged to master; this
  analysis is a NEW track, independent of the packaging/email-inbox tracks.
