# Skill conventions — AiWorkflow

Shared conventions for skills in this repo. The organizing lens is the **genre split**
(Part 1): every convention below applies differently to the two genres. **Only Part 2 is
mandatory** — Part 3 documents proven shapes you may borrow, not requirements. Keep skills
lean; we have few of them on purpose (see `docs/AGENTIC.md` A4 — write a skill only when the
task has RECURRED).

This doc governs **skills**. The framework's other two knowledge layers are docs (the map —
`CLAUDE.md`, `HANDOFF.md`, `docs/`) and hooks (deterministic enforcement — `.claude/hooks/`,
see Part 5). The three-layer model is `docs/AGENTIC.md` A8.

## Part 1 — The three skill kinds (read this first)

Which conventions apply depends entirely on which kind a skill is. There is one reference kind
(Rules) and two staged kinds (Procedures and Tasks) — the split between the latter two is **who
owns the run**, and that determines the self-improvement requirement.

|                            | **Rules** (genre 1)                                | **Procedures** (genre 2a)                                | **Tasks** (genre 2b)                         |
| -------------------------- | -------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------- |
| What                       | Topical reference: gotchas, invariants, a code map | A reusable sub-procedure (a building block)              | A recurring end-to-end task                  |
| Owns the run               | —                                                  | **No** — invoked as a step (or standalone for a one-off) | **Yes** — the entry point for the task       |
| Shape                      | One markdown file, a titled list                   | `SKILL.md` folder, staged checklist                      | `SKILL.md` folder, stages + gates            |
| Location                   | `.claude/skills/rules/<topic>.md`                  | `.claude/skills/<verb>-<noun>/SKILL.md`                  | `.claude/skills/<verb>-<noun>/SKILL.md`      |
| Loaded                     | On demand, when the topic is in play               | On match of its `description`, then followed             | On match of its `description`, then followed |
| Stages / gates             | None                                               | Yes                                                      | Yes                                          |
| **Self-improvement stage** | No                                                 | **No** (the calling Task owns reflection)                | **Required** (Part 2.1)                      |
| Example                    | `rules/copilotkit-v2.md`                           | `browser-verify/`                                        | `add-workflow/`, a future `bug-fixing/`      |

How to tell Procedure from Task: does this skill **own a whole run** (it's what the user invokes
to get a recurring job done end-to-end)? → **Task**. Is it a **building block** that bigger skills
call mid-flow (and that you might also run standalone for a quick one-off)? → **Procedure**.

If you're unsure between staged (genre 2) and a rule: is there a _procedure with steps and
decisions_? → genre 2. Is it _facts to recall while doing something else_? → genre 1. When in
doubt, a rule is cheaper and lighter — prefer it until a real multi-stage procedure emerges.

**Procedures stay maintained without their own self-improvement stage:** a Task's self-improvement
(Part 2.1) may amend any Procedure or Rule it used during the run. One reflection per run, owned by
the Task, writes findings back into every skill it touched — so a building block never needs to
review itself mid-task (which would fire early, or double the parent's prompt).

## Part 2 — Hard requirements (the only mandatory rules)

1. **Self-improvement stage (Task skills only — NOT Procedures).** Every **Task** skill ends with a
   final self-improvement stage; a **Procedure** must NOT have one (the calling Task owns
   reflection — Part 1). It runs LAST, after the final gate and after any commits land. It is
   **meta-work on the skill, not the user's task** — so a **silent skip is the correct default**.
   First do honest analysis (did the user correct the same behavior repeatedly? did the skill's
   instructions not match what the work needed? did the user ask for it?). If nothing systemic
   surfaced, write one sentence ("Run went smoothly, nothing systemic surfaced.") and exit. If a
   finding holds, propose **only systemic process changes** (to how the skill instructs the
   work), 1–2 items max, each **quoting the run incident that motivated it**, as plain text — no
   apply/save/discard picker, never label anything "Recommended", passing is the default. Do not
   propose code-specific gotchas here (those go in a `rules/` file or `references/`). **This stage
   may amend any Procedure or Rule the run used**, not just the Task's own `SKILL.md` — e.g. a
   missed step in a Procedure it called gets written back into that Procedure's
   `references/`. This is the engine that keeps every skill current without a human curator.

2. **Register in `README.md` (both genres).** Creating a skill ⇒ add a row to the skills index
   in `.claude/skills/README.md`. If it changes what belongs in "Tasks without a skill," update
   that section too. Drift in the index means new skills go undiscovered and unused.

3. **Self-contained — no external-plugin dependency (`docs/AGENTIC.md` A5).** Inline every stage
   a skill needs. A skill must NEVER _require_ superpowers or any other plugin to run — borrow
   the _structure_ and write it out. (Consumer repos won't have superpowers; and core process
   living in a third-party plugin is unversioned drift, which the philosophy forbids.) Superpowers
   stays an optional aid for genuinely NOVEL work only, never a runtime dependency of a skill.

4. **Frontmatter `description` is the discovery surface.** `name` (kebab-case) + `description`
   are required. Write the `description` in the **third person**, stating **what the skill does
   AND when to use it**, with concrete **trigger terms** the user is likely to say. A vague
   description means the skill never triggers. (Good: "Drive the real app in a browser to verify
   a change works end-to-end before claiming it done. Use when about to say a fix is done /
   ready-to-merge, when running browser E2E, or when a dev server or port misbehaves." Bad:
   "Helps with testing.")

5. **`browser-verify` is mandatory when a skill's change touches the running app.** This repo's
   defining bug class is "only the browser catches it" (typecheck + unit tests pass while the app
   is broken). Any genre-2 skill whose work changes client/server runtime behavior MUST end its
   work by invoking the `browser-verify` procedure before reporting done — never claim "works" on
   unit tests alone.

6. **Everything is written in English.** All skill content — `SKILL.md` and rule bodies,
   `references/`, frontmatter, code, comments, identifiers, examples, and the README index — is
   in English, regardless of the language used in chat. This is the project-wide rule (`CLAUDE.md`
   Conventions): docs are authored once, for any agent or contributor, in English.

7. **Foundation check (Task skills only).** Every **Task** skill includes a stage that runs the
   `check-foundation` procedure before reporting done — verifying the change does not violate or
   erode the philosophy (`../../docs/PHILOSOPHY.md`) or an architecture invariant
   (`../../docs/ARCHITECTURE.md` section 0, I1–I15). A detected conflict is a **STOP**: warn the
   developer explicitly and get their **direct confirmation** before proceeding; never change the
   foundation silently. Procedures do not run this themselves — the calling Task does (mechanical
   backstop: the `guard-foundation-edits` hook).

## Part 3 — Reference patterns (proven shapes, not required)

Borrow and adapt; document significant deviations in your `SKILL.md` so future maintainers
understand why.

- **Naming: `<verb>-<noun>`** — `browser-verify`, `add-workflow`, `add-render-card`. (Magma uses
  `<package>-<verb>-<noun>`; we're app-centric, so the package prefix is dropped.)

- **File layout & progressive disclosure.** `SKILL.md` (the body, kept under ~500 lines) +
  `references/` for depth. Keep references **one level deep** from `SKILL.md`; add a table of
  contents to any reference file over ~100 lines. `scripts/` is optional for deterministic ops.
  Only the `description` sits in context until the skill matches; references load only when their
  stage needs them.

- **The staged shape** (lighter than magma's ~12). A **Task**: preflight → user intent → [GATE] →
  implement → validate → **self-improvement** (last). A **Procedure**: preflight → do the steps →
  report — it ends at its report and has **no** self-improvement stage. L1 dev skills stay
  moderate; the future L2 consumer twins are lighter still (4–6 steps, 1–2 gates).

- **TDD cycle — inlined per skill, the vehicle is often the browser.** When a skill's task is
  test-shaped, inline the cycle: write the failing check FIRST → confirm it fails for the reason
  you predicted (RED) → implement to GREEN at the smallest scope → prove the check is real
  (remove the fix / sabotage it → must go RED again). **Pick the vehicle by bug shape:** a
  pure-logic change → a vitest unit test written first; anything that touches the running app →
  the **browser E2E is the RED→GREEN vehicle** (see Part 2.5), because unit tests miss this
  codebase's bug class. The full "RED Playwright test before the fix + three-way sabotage check"
  shape is prior art in `~/Magma/teachers-web/.claude/skills/bug-fixing` — a future AiWorkflow
  bug-fix skill inlines it; it is never imported.

- **Gates, and anti-rationalization.** Mark real decision points `[GATE]` and wait for the user.
  A user saying "go through all stages" means "don't ask redundant procedural questions" — it
  does **not** authorize skipping a meaningful confirmation on a concrete artifact (an example
  set, a test block, a diff). Meaningful gates stay mandatory.

- **Ask about INTENT, probe the code for FACTS.** You have the source, the tools, and the running
  app. Anything mechanically discoverable (current behavior, the nearest matching code, whether a
  similar case already works) — find out yourself before asking. Ask the user only about intent,
  external stakeholders, or a genuine ambiguity that probing surfaced. List in the skill what NOT
  to ask.

- **Quote past-run incidents verbatim in the body.** When a real run exposed a trap, write the
  incident next to the stage it affects ("Past-run incident: the user wrote X, I assumed Y, they
  pushed back twice; the probe at step N would have caught it"). The skill learns from its
  failures in place; the self-improvement stage (Part 2.1) is what writes these back.

- **Escape hatches, never silent.** Give each risky stage a named exit condition and action
  (e.g. "subagent iterations > 3 → stop, surface to user"). Exiting is fine; exiting silently is
  not — always say what was found and what you recommend next.

- **Subagent-per-iteration for implementation loops.** For a GREEN loop, dispatch a fresh
  subagent per iteration (context isolation); the orchestrator reviews each diff + targeted test
  and decides Accept / Iterate (fresh subagent) / Stop. Don't let one subagent accumulate
  attempts.

- **The skill classifies the task, not the user.** If a skill covers several task forms, detect
  the form yourself during code exploration; don't make the user self-classify upfront. For a
  form the skill doesn't yet automate, emit an honest handoff report and exit cleanly rather than
  faking the work.

## Part 4 — Creating a new skill

1. Decide the kind (Part 1): Rule, Procedure, or Task. A rule is cheaper — prefer it unless
   there's a real staged procedure. Then: does it own a whole run (Task) or is it a building block
   (Procedure)?
2. Confirm the task has actually RECURRED (`docs/AGENTIC.md` A4) — no speculative skills.
3. Write a clear third-person `description` (Part 2.4). **Task:** include the self-improvement
   stage (Part 2.1). **Procedure:** do NOT add one — it ends at its report.
4. Borrow Part 3 patterns as they fit; document deviations.
5. **Register in `README.md`** (Part 2.2). Update "Tasks without a skill" if the boundary moved.

## Part 5 — When a rule becomes a hook

Some rules deserve mechanical enforcement, not just prose. Promote a rule to a hook
(`.claude/hooks/` + `settings.json`) when it is: a hard rule + mechanically detectable trigger +
high violation cost + a true **invariant** (not current-project context). A hook is a BACKSTOP —
the rule (and its skill, if any) still owns the flow; the hook blocks the mechanical action when
the flow was skipped. Full criterion and the invariant-vs-context lesson: `docs/AGENTIC.md` A8.
