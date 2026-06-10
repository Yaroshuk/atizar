# Skill index — AiWorkflow

Reference for AI agents and contributors. This repo's agent knowledge has three layers
(`docs/AGENTIC.md` A8): **docs** are the map (`CLAUDE.md`, `HANDOFF.md`, `docs/`), **skills**
are procedures and topical reference (here), and **hooks** are deterministic enforcement
(`.claude/hooks/`). Skills come in two genres — see [`CONVENTIONS.md`](CONVENTIONS.md) Part 1.

When the user's request matches a skill's trigger description, invoke it (via the `Skill` tool,
or `/<skill-name>` in interactive sessions). When it doesn't, do the work directly — skills are
for recurring patterns, not every task. The build order for upcoming skills lives in
[`docs/AGENTIC.md`](../../docs/AGENTIC.md) (Phase 1); we add a skill only once the task has
RECURRED, never speculatively.

The two staged kinds are **Tasks** (own a whole run, have a self-improvement stage) and
**Procedures** (building blocks invoked by Tasks, or standalone for a one-off; no self-improvement
stage). See [`CONVENTIONS.md`](CONVENTIONS.md) Part 1. The build order for the rest lives in
[`docs/AGENTIC.md`](../../docs/AGENTIC.md) Phase 1.

### Tasks (genre 2b — own a run)

| Skill        | When to use                                         | SKILL.md |
| ------------ | --------------------------------------------------- | -------- |
| _(none yet)_ | `add-workflow` is next (Phase 1, `docs/AGENTIC.md`) |          |

### Procedures (genre 2a — building blocks)

| Skill            | When to use                                                                                                                                                                                                                                                                              | SKILL.md                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `browser-verify` | About to claim a change is done/working/ready-to-merge; running a browser E2E or verifying an HITL approval flow; starting `yarn dev`; or a dev server / port / `EADDRINUSE` / self-reloading page / Playwright-MCP browser misbehaves. Invoked as a step by Task skills, or standalone. | [browser-verify/SKILL.md](browser-verify/SKILL.md) |
| `check-foundation` | Before a change lands, or as a stage in any development / bug-fixing / feature Task; or standalone when unsure whether a change touches the philosophy or base architecture. WARNs and requires explicit developer confirmation on a foundation conflict. | [check-foundation/SKILL.md](check-foundation/SKILL.md) |

## Rules (genre 1 — topical reference)

| Rule                                               | Covers                                       |
| -------------------------------------------------- | -------------------------------------------- |
| [`rules/copilotkit-v2.md`](rules/copilotkit-v2.md) | CopilotKit v2 + AG-UI gotchas (quick recall) |
| [`rules/cassettes.md`](rules/cassettes.md) | `DEV_RECORD_REPLAY` cassettes: recall-facts + the share-safety procedure |

## Tasks without a skill (handle directly)

- **One-off bug fixes, refactors, performance, docs-only changes** — no skill; just do the work
  (and `browser-verify` if it touches the running app).
- **A genuinely novel feature** — there's no recurring procedure to follow; brainstorm it
  (superpowers is fine as an optional aid for novel work — never as a skill dependency, see
  `CONVENTIONS.md` Part 2.3).
- **Anything not yet recurring** — don't invent a skill ahead of the need (`docs/AGENTIC.md` A4).

## Maintainer note

Creating a skill ⇒ follow [`CONVENTIONS.md`](CONVENTIONS.md) Part 4, and **register it in this
file** — add a row to the table for its genre with name, when-to-use, and link. If the new skill
changes what belongs under "Tasks without a skill," update that section too. The index is how
agents discover what exists; drift here means new skills go unused.
