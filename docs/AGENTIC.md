# Agentic setup — handoff & roadmap

Living handoff for the **agentic-first infrastructure track**: how agents (not humans) write,
maintain, and consume this framework — docs layout, skills, and the delivery channel to consumer
projects. This track runs BESIDE the beta build order in `HANDOFF.md` (features); update this file
the same way (mark items ✅ BUILT with an as-built note).

**The thesis (from the ATIZAR philosophy, belief #3):** the framework is "обмазано скилами" —
thin contracts + skills that teach an agent the format + worked examples. This file is where that
stops being a phrase and becomes a build list.

## The two layers

| Layer | Who | What they need | Status |
|---|---|---|---|
| **L1 — dev** | Agents developing the framework itself (this repo) | `CLAUDE.md` gotchas, `HANDOFF.md` state, **repo-specific recurring-task skills** | Docs ✅ strong; skills ❌ none yet (only `rules/`) |
| **L2 — consumer** | Agents in client projects that depend on `@platform/*` | Skills **shipped inside the packages** that teach each thin contract | ❌ Deliberately deferred (contracts still moving) |

## Ecosystem anchors (verified June 2026 — don't re-research)

- **Agent Skills (SKILL.md)** is an open standard (Anthropic, Dec 2025), adopted by Codex CLI,
  Gemini CLI, GitHub Copilot. Format: YAML frontmatter (`name`, `description`) + markdown body +
  `references/` + optional `scripts/`. Progressive disclosure: only the description sits in
  context; the body loads on match.
- **AGENTS.md** is the cross-agent equivalent of `CLAUDE.md` (project context). Settled split:
  AGENTS.md = project context, skills = portable procedures.
- **Skills inside npm packages is a working convention**, not our invention: Anthony Fu's
  `skills-npm` discovers skills shipped in installed packages and symlinks them to the agent.
  This is exactly the philosophy's "скилы едут внутри пакетов, discovery из node_modules" —
  the ecosystem caught up; we build on the convention instead of inventing delivery.
- Marketplaces exist (skills.sh etc.) — distribution infrastructure is explicitly NOT ours to
  build (philosophy: don't over-invest in the framework's elegance).

## Decisions

- **A1 — Open Agent Skills format everywhere.** Every skill (dev and consumer) is a standard
  SKILL.md folder. No proprietary format, no skills in a DB (philosophy hard "no").
- **A2 — Two genres, never mixed.** *Rules* = cheap topical reference loaded on demand
  (`.claude/skills/rules/` — exists). *Recurring-task skills* = staged procedures with gates
  (none exist here yet; prior art = magmamath-tools).
- **A3 — Dev skills NOW, consumer skills AFTER the contracts stabilize.** A consumer skill
  teaches a contract; writing it while `Provider`/`ServerBinding`/package boundaries churn
  (beta steps 5–7) means rewriting it. Dev skills encode procedures that already recur today.
- **A4 — A skill is written when the task has RECURRED, not speculatively.** Same organic-growth
  rule as `.claude/skills/rules/README.md`. The Phase-1 list below is ordered by observed
  recurrence, not by ambition.
- **A5 — Skills are SELF-CONTAINED: no dependency on superpowers or any external plugin.**
  (Corrected 2026-06-10 after user pushback — the original draft said "keep superpowers for
  process".) The magma precedent is the model: `template-validator-enhance-template` *borrows*
  the TDD/gates/subagent structure but **inlines every stage** ("no external skill
  dependencies") — and it works very well. Two reasons it's the right call here too:
  (1) L2 consumer repos will NOT have superpowers installed — a consumer skill that assumes it
  is broken on arrival, and L1 skills follow the same discipline so the L1→L2 twin rewrite is
  mechanical; (2) our own story is "skills ship with the code" — core process living in a
  third-party plugin is unversioned drift, exactly what the philosophy forbids.
  Superpowers remains an optional environment-level aid for NOVEL work only (brainstorming a
  brand-new feature) — novel work isn't recurring, so it isn't skill-shaped. Nothing in this
  repo's skills or docs may REQUIRE it; as Phase-1 skills absorb the recurring procedures,
  superpowers usage shrinks to those creative edges by itself.
- **A6 — Port three magma skill conventions** (proven in magmamath-tools):
  (1) a `README.md` skills index with an explicit **"tasks without a skill"** boundary;
  (2) a final **self-improvement stage** in every recurring-task skill (silent skip by default;
  incidents from real runs get written back into the SKILL.md — this is how skills stay
  up-to-date without a human);
  (3) **past-run incidents quoted verbatim in the skill body** — the skill learns from its
  failures in place.
- **A7 — Consumer skills mirror the public SDK, one per thin contract,** and live in the package
  whose contract they teach (`packages/<pkg>/skills/<name>/SKILL.md`), versioned with the code —
  drift is impossible by construction. The demo app is the worked example each one points at.
- **A8 — Hooks are the THIRD layer: deterministic guarantees, enforced by the harness.**
  Docs = the map (model should read), skills = procedures (model should follow), hooks =
  enforcement that runs REGARDLESS of what the model decides. This is the philosophy's
  "guarantee in code, not in prompt" applied to our own dev environment — the same principle
  as server-executed effects. **Criterion for promoting a rule to a hook:** hard rule +
  mechanically detectable trigger + high violation cost. A hook is a BACKSTOP, not the
  procedure: the CLAUDE.md rule (and its skill, if any) stays and owns the flow; the hook
  blocks the mechanical action when the flow was skipped. Don't chase hermetic coverage
  (no DLP) — block the obvious vectors, the human rule covers the rest. Hooks live in
  `.claude/hooks/` + project `settings.json`, versioned with the repo.
- **A9 — Two staged skill kinds: Procedures vs Tasks (refines A6).** (Added 2026-06-10 after user
  pushback while building `browser-verify`.) The magma precedent knew only top-level **Task**
  skills (own a whole run end-to-end), for which the mandatory self-improvement stage is right.
  But a skill like `browser-verify` is a **Procedure** — a building block invoked mid-flow by a
  Task (a future `bug-fixing`, `add-workflow`, feature work), or run standalone for a one-off. The
  split is **who owns the run**: only Tasks do, so **self-improvement is Task-only; Procedures must
  NOT have it** (a building block reflecting mid-task would fire early or double the parent's
  prompt). Procedures stay maintained because a **Task's self-improvement may amend any Procedure
  or Rule it used** — one reflection per run, owned by the Task, writes findings back into every
  skill it touched. Full convention: `.claude/skills/CONVENTIONS.md` Part 1 + 2.1.

## Roadmap

### Phase 0 — scaffolding (cheap, do on the next docs touch)

- ✅ **`AGENTS.md` at repo root** — BUILT (2026-06-10). Thin pointer file (not a symlink — clearer
  for git/tools, no second copy) to `CLAUDE.md` with the read order + skills/conventions links +
  the English-only note. Cross-tool standard name; `CLAUDE.md` stays canonical.
- ✅ **`.claude/skills/README.md`** — BUILT (2026-06-10). Skills index, split by genre
  (recurring-task table = empty, `browser-verify` next; rules table = `copilotkit-v2.md`) +
  "Tasks without a skill" boundary + maintainer "register it here" note.
- ✅ **`.claude/skills/CONVENTIONS.md`** — BUILT (2026-06-10). Genre split (Part 1) as the lens;
  Part 2 hard requirements (self-improvement stage, README registration, self-contained/A5,
  `description` as discovery surface, browser-verify mandatory when touching the running app,
  English-only); Part 3 reference patterns (naming `<verb>-<noun>`, layout/progressive
  disclosure, staged shape, **TDD cycle inlined per skill — vehicle is often the browser**, gates
  + anti-rationalization, INTENT-vs-FACTS, verbatim incidents, escape hatches, subagent-per-
  iteration, skill self-classifies); Part 4 create-checklist; Part 5 hook pointer to A8. Shorter
  than magma's.
- ✅ **`guard-cassette-share` hook** (first hook, per A8) — BUILT & tested (2026-06-10). PreToolUse
  on Bash (`.claude/hooks/guard-cassette-share.sh` + `.claude/settings.json`): blocks
  `git add|stash|commit` naming a `.cassettes` path (incl. `add -f`) and `.gitignore` edits that
  touch the cassettes line; exit 2 + message pointing at the scanCassette share-safety flow (the
  CLAUDE.md hard rule stays — the hook is its backstop). Verified 6-block/6-pass via a file-based
  test driver (the launcher's own text can't carry the trigger, else the live hook blocks it —
  it self-demonstrated by blocking the first inline test). **Hook candidates after it** (apply the A8 criterion,
  don't batch-build): Magma-board write guard (block mutating `gh` subcommands **targeting the
  `matteappen` org only** — the protected object is the real production board the demo reads,
  NOT GitHub as such; a writable GitHub integration is legitimate future framework work and
  goes through gates + server-executed effects like any other); subagent branch-switch guard
  (`git checkout <sha>`/`git switch` — a real past incident, see CLAUDE.md gotcha).
  **A8 lesson (2026-06-10, from user pushback):** a hook encodes an INVARIANT (cassettes hold
  real PII — always), never current-project context (today's demo data source happens to be a
  production board). If a legitimate future feature would have to violate the rule, it fails
  the criterion — scope the rule to the actual protected object instead.
- ✅ **Foundation protection (docs + skill + hook + convention)** — BUILT & tested (2026-06-10).
  The framework's identity is now a protected, three-layer concern:
  - **Docs (the map):** `docs/PHILOSOPHY.md` authored fresh (the three beliefs, conscious "no"s —
    framework-only, no business/personal material, no dated patches) and `docs/ARCHITECTURE.md`
    section 0 = the canonical invariants **I1–I15** (philosophy-derived + pipeline-locked). These
    are the canonical protected statement; `pipeline-updated-3.md` stays the editable build spec.
  - **Skill (the procedure):** `check-foundation` — a **Procedure** (genre 2a) that reads
    PHILOSOPHY + the invariants and checks a change against them; a violation/tension is a STOP →
    WARN + the developer's direct confirmation. Registered in the skills README.
  - **Convention:** `CONVENTIONS.md` Part 2.7 — every **Task** skill runs `check-foundation`
    before reporting done.
  - **Hook (the backstop):** `guard-foundation-edits.sh` (PreToolUse on Edit/Write/Bash) prompts
    `permissionDecision:"ask"` (verified schema — exit 0 + JSON; "ask" lets the human confirm,
    not a hard block) on any edit to `PHILOSOPHY.md` / `ARCHITECTURE.md`. Tested 10/10 (4 ask, 6
    defer; reads and other files defer). Anchor rule added to `CLAUDE.md`.
  - **Deferred:** the clean self-contained `docs/pipeline.md` (replacing the badly-named
    `pipeline-updated-3.md` + its cross-references) is written **after** the beta lands (~step 7),
    and **added to the hook's protected set then** — the hook protects the FINAL docs, not the
    temporary build spec.

### Phase 1 — dev skills (L1), priority by recurrence

Build top-down; each skill absorbs an existing CLAUDE.md gotcha block (the gotcha shrinks to a
pointer once the skill owns the procedure — CLAUDE.md stays the map, skills own the routes).

1. ✅ **`browser-verify`** — BUILT (2026-06-10), the first staged skill (the form exemplar). It is a
   **Procedure** (genre 2a, A9), not a Task — a building block invoked by Task skills or run
   standalone; **no self-improvement stage** (the calling Task owns reflection).
   `.claude/skills/browser-verify/SKILL.md` (Stages 0–6, verbatim past-run incidents, Red-flags
   table) + 3 references (`dev-servers.md`,
   `playwright-recovery.md`, `e2e-checklist.md`). Absorbed: kill stale dev stacks (root `.bin`
   pattern + tsx-child trap), free `:4000`/`:5173`, `EADDRINUSE`/self-reload diagnosis,
   Playwright-MCP profile-lock recovery, record-vs-replay (`=record` for concurrent HITL — replay
   masks it via shared toolCallId), `?dev=1`/`?spike=1` surfaces, the flow checklist + "only the
   browser catches it" catalog. Registered in `.claude/skills/README.md`. The two CLAUDE.md gotcha
   blocks (dev-server hygiene + Playwright lock) were **shrunk to a one-line pointer** at the skill
   (CLAUDE.md stays the map). Cassette knowledge → `rules/cassettes.md` (genre-1 rule, #2).
2. ✅ **`rules/cassettes.md`** — BUILT (2026-06-10), a **genre-1 Rule, not a skill** (decided after
   user pushback). Cassette care splits into recall-facts (modes, "replay masks a prompt change,"
   true-replay check, the multi-instance `toolCallId` masking) + a 3-step share-safety procedure
   (`scanCassette` → report `file:line` → wait). Neither is a multi-stage gated flow: the
   recall-facts are reference, and share-safety is already mechanically triggered + enforced by the
   `guard-cassette-share` hook (a skill would just duplicate the hook's trigger). So it lives as a
   rule in `.claude/skills/rules/`, pointing to `docs/dev-record-replay.md` for depth. Registered
   in the skills README.

3. ✅ **`write-integration`** — BUILT (2026-06-11), the first **Task**-genre skill
   (`.claude/skills/write-integration/SKILL.md`, Stages 1–8 incl. the mandatory self-improvement
   + check-foundation stages). Authoring an integration recurred (gmail-basic was the first;
   gmail-viewer the second) once the **email-inbox workflow track** was inserted before the
   packaging tail (`docs/superpowers/specs/2026-06-11-email-inbox-workflow-design.md`), so A4's
   recurrence bar is met now rather than post-beta. Validated by its first real run:
   `@platform/integrations/gmail-viewer` (listUnread/getEmail reads, markRead/trash/star
   best-effort batch mutations, a shared `checkCredentials` health ping in gmail-basic, a
   read-only stdio MCP wrapper). Registered in `.claude/skills/README.md`. As of sub-stage 4
   (2026-06-11) the `write-integration` skill ENFORCES the integration auth contract —
   declare-not-self-read (the integration exports `auth: AuthSpec` and receives `deps.credential`,
   never reads secrets itself), a mandatory stop-and-ask auth interview, `ATIZAR_` env naming, and
   seeding the repo-root `.env.example`. As of sub-stage 5 (2026-06-12) the auth contract is proven
   end-to-end — the `write-integration` skill's worked exemplar is now the unified
   `@platform/integrations/gmail` integration (declare `auth` + `deps.credential`, validated by a
   live browser E2E on both the claude-cli and Mastra providers). **Roadmap
   reconciliation:** this is the L1 dev twin of the planned post-step-7 `add-integration` (L2,
   below) — the L1 skill exists now because the dev task recurred; the L2 consumer twin (lighter,
   for userland with no repo context) is still Phase 2.

**L1 dev skills are complete for now.** The recurring dev-side procedures are captured
(`browser-verify` + `cassettes` + `write-integration` + the foundation/conventions infra). We add
another L1 skill ONLY when a dev task actually recurs and bites (A4) — not by marching a list.

The following were considered for L1 but are **CONSUMER skills (L2 → Phase 2)** — they teach the
public SDK, not framework internals, so a userland developer runs them on top of the framework:

- ❌ **`add-workflow`** — scaffold a workflow + tool classification + register cards. "Add a
  workflow" is THE core consumer action; it belongs in `@platform/core`/`@platform/server` (L2).
- ❌ **`add-render-card`** — render-spec registration, `ThreadResultsContext` for data tools,
  browser-verify. A consumer surfaces a custom card on top of the framework → L2.

Post-beta first drafts of their L2 twins (gated on beta progress, NOT now):

- ❌ **`add-provider` / `write-provider`** (in `@platform/providers`) — parked for later by the user
  (2026-06-11), explicitly AFTER the beta demo. Teaches the `AgentRuntime`/provider seam (the
  injected-runner pattern, the AG-UI chunk→event mapping, `GATE_OPENED` synthesis, native vs
  re-prime resume); the **provider conformance suite is the definition-of-done**. The first real
  exercise is adding a non-Mastra, non-CLI provider — the Anthropic SDK directly — gated on demand
  (the two shipped providers, claude-cli + Mastra, already satisfy I4 for the beta).
- ❌ **`add-integration`** — after beta step 7 (extraction); the `@platform/integrations` contract +
  the `ServerBinding` effects seam, with `gmail-basic` as the worked example. The flagship L2 skill.

### Phase 2 — consumer skills (L2), after beta step 7

The "no integrations catalog" differentiator made literal. One skill per public contract,
shipped inside its package:

- ✅ **First A7 consumer skill shipped (2026-06-11):**
  `packages/integrations/skills/gmail-viewer/SKILL.md` — how-to-use + wiring (read tools vs
  server-effect mutations) + credentials setup + a `checkCredentials` failure-diagnosis table.
  It ships INSIDE the package, versioned with the code (A7), and the email-inbox spec's
  credential-health `hint` points at it. A3's "after the contracts stabilize" bar is met for the
  `@platform/integrations` contract (it's stable; only the workflow/react contracts are still
  moving). This is the first concrete instance of the `add-integration` flagship below.
- ✅ **Thin integration contract landed (email-inbox stage 2):** `HealthCheck` /
  `ReadResult<T>` / `BatchActionResult` — types only in `@platform/core`, no
  `defineIntegration()`, no base class (belief #3). The `write-integration` skill and the
  gmail-viewer consumer skill now reference these types; integrations import them from
  `@platform/core` instead of re-declaring result shapes.
- ❌ `add-integration` (in `@platform/integrations`) — the flagship; proves "Claude writes your
  integration in a minute, guided by the skill". (Its L1 dev twin `write-integration` is BUILT —
  see Phase 1 #3; this L2 twin is the lighter userland-facing rewrite.)
- ❌ `add-workflow` / `add-agent` (in `@platform/core` or `@platform/server` post-extraction).
- ❌ `add-render-card` (in `@platform/react` post-extraction) — register a custom card on the
  render registry; `ThreadResultsContext`/`useThreadResult` for data tools.
- ❌ `add-provider` (in `@platform/providers`) — conformance suite as the contract.
- ❌ Consumer-project `AGENTS.md` template — what a client repo's context file should say about
  the framework (possibly emitted by a future `init`, but a copy-paste template ships first).

Each = the L1 twin, rewritten for an audience that has NOT read this repo: lighter (4–6 steps,
1–2 gates, not magma's 12 stages), self-contained, worked example from the demo app.

### Phase 3 — delivery (deferred, deliberately thin)

- ❌ Follow the `skills-npm` discovery convention so consumer skills are found in
  `node_modules` automatically. Convention only — no CLI, no catalog, no marketplace until
  real demand (philosophy's "осознанные нет").

## Not doing (so future sessions don't relitigate)

- No skills/knowledge in a DB; no marketplace/catalog/CLI now (Phase 3 stays a convention).
- No skill may depend on an external plugin (superpowers included) — stages are inlined (A5).
  The flip side also holds: don't rebuild generic process skills wholesale for ideology —
  inline only the stages a skill actually uses.
- No consumer skills before the contract they teach has stabilized (A3).
- No speculative skills — recurrence first (A4).
