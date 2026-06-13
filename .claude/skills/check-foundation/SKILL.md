---
name: check-foundation
description: Check a change against the framework's foundation — the three beliefs in PHILOSOPHY.md and the locked invariants I1–I15 in ARCHITECTURE.md — before it lands. Use as a stage in any development or bug-fixing task, or standalone when unsure whether a change touches philosophy or base architecture. On a violation or tension it WARNs and requires the developer's explicit confirmation before proceeding.
---

# Check-foundation

The procedure that protects the framework's identity. The philosophy
([`../../../docs/PHILOSOPHY.md`](../../../docs/PHILOSOPHY.md)) and the locked architecture
invariants ([`../../../docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md) section 0, I1–I15) are
**foundational and protected**. A change that violates or quietly erodes one of them changes what
the framework _is_ — and that must never happen silently.

**Core principle:** a foundation conflict is not a thing to "decide and move on" from. It is a
**STOP**: warn the developer explicitly, name the belief/invariant and how the change conflicts,
and proceed only on their **direct confirmation** that they intend it.

This is a **Procedure** (a building block — [`../CONVENTIONS.md`](../CONVENTIONS.md) Part 1), not a
Task: it is invoked as a stage BY Task skills (development, bug-fixing, feature work) — or
standalone when you're unsure whether a change touches the foundation. It does **not** own the run
and has **no self-improvement stage**. Self-contained.

## Stages

### Stage 0 — Scope

State in one line the change under review (the diff, or the planned edit). When invoked by a Task,
this is that Task's diff or plan.

### Stage 1 — Load the foundation (do not work from memory)

Read the canonical, protected statements — the wording matters, recall is not enough:

- [`PHILOSOPHY.md`](../../../docs/PHILOSOPHY.md) — the three beliefs and the conscious "no"s.
- [`ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md) section 0 — invariants **I1–I15**.

### Stage 2 — Check the change against the foundation

For each area the change touches, ask of every relevant belief / invariant: does the change
**contradict** it, **erode** it, or quietly **route around** it? Be concrete — name the file/line
and the invariant. Common conflicts to watch for:

- A consequential action the **model** executes directly instead of the **server** → I2 / I9.
- A schedule or auto-trigger that fires an action without a human start → I1.
- An engine import inside `@atizar/core`, or the core gaining engine features (memory / RAG /
  tool-execution) → I3.
- Userland importing internals, or a path that bypasses the public SDK → I5.
- Skills / knowledge moved into a database; or a tool left unclassified so it ships ungated → I6 /
  I15.
- An irreversible or meaningful action path with no approval gate → I1.
- A change to a provider that breaks the AG-UI translation or the conformance contract → I3 / I4.
- **Editing `PHILOSOPHY.md` or `ARCHITECTURE.md` section 0 itself** — always foundational; Stage 3
  applies by definition.

### Stage 3 — Verdict

- **Clear** — no belief or invariant is touched or eroded. Say so in one line and let the calling
  Task proceed.
- **Violation or tension** — **STOP. Do not proceed silently.** Warn the developer explicitly:
  - which belief / invariant (e.g. "I9 — server-executed effects"),
  - the file/line and **how** the change conflicts,
  - that this **changes the framework's identity and is dangerous and delicate**.

  Then require the developer's **direct confirmation** that they intend the change and accept the
  consequence. Continue only on explicit confirmation. If the change stands and it alters an
  invariant's text, that edit itself follows the protected-edit rule (the `guard-foundation-edits`
  hook will also prompt).

This Procedure ends at its verdict — no self-improvement stage (the calling Task owns reflection,
[`../CONVENTIONS.md`](../CONVENTIONS.md) Part 1).

## Red flags — STOP, you're rationalizing

| Thought | Reality |
|---|---|
| "It's a small change, skip the check." | A small change can route around a gate or import an engine into the core. Run the check whenever a change touches actions, providers, `@atizar/core`, the framework/userland boundary, or the foundation docs. |
| "I'll just edit the invariant to match my change." | That IS the foundation changing — warn + explicit confirmation, never silent. |
| "The model can execute this directly, it's simpler." | I2 / I9 — the server executes, the model proposes. Simplicity is not a waiver. |
| "The developer's busy, I'll note it and move on." | A foundation conflict is a STOP, not a footnote. Get the explicit confirmation. |
