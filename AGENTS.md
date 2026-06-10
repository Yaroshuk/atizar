# AGENTS.md

This repo's agent context lives in **[`CLAUDE.md`](CLAUDE.md)** — read it first. `AGENTS.md` is
the cross-tool standard name (Codex, Cursor, Gemini CLI, Copilot); `CLAUDE.md` is the canonical
source and this file is a thin pointer to it, not a second copy (one source, no drift).

**Read order:**

1. [`CLAUDE.md`](CLAUDE.md) — stable project reference: stack, packages, hard invariants,
   don't-rediscover gotchas, decisions, commands.
2. [`HANDOFF.md`](HANDOFF.md) — living session state: current status + the next thing to build.
3. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the full vision & architecture.
4. [`docs/AGENTIC.md`](docs/AGENTIC.md) — the agentic-first track: how agents write, maintain,
   and consume this framework (docs / skills / hooks / delivery).

**Skills & conventions:** [`.claude/skills/README.md`](.claude/skills/README.md) (index) and
[`.claude/skills/CONVENTIONS.md`](.claude/skills/CONVENTIONS.md) (authoring standard).

All project content is written in English regardless of the language used in chat.
