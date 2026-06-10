# Philosophy

**A thin, human-oriented control layer that turns any agent runtime into a clear, controllable,
reusable workflow.** The developer assembles it, the human conducts it, the agent executes.

This document is the *why* — the principles every feature and constraint derives from. It is
foundational and protected (see the last section). The locked architectural decisions that follow
from it live in [`ARCHITECTURE.md`](ARCHITECTURE.md), section 0 (Invariants).

## What this is

A framework for engineers who build agentic automations for companies. It presents **two modes
over one source of truth** (config + code):

- **Developer mode** — the engineer assembles pipelines with code, config, and skills.
- **Consumer mode** — a clean UI where a non-technical person starts agents, sees results as
  cards, and approves actions. They never see or touch code.

It is deliberately **not** an agent runtime and **not** another autonomous agent. It is a layer of
orchestration and display that stands on top of whatever engine you choose (Mastra, Claude Code,
…). Its value is the thinness and the discipline, not a new engine.

## The three beliefs

Everything derives from these three. A feature that does not follow from a belief is probably
superfluous. The constraints each belief imposes are not a limitation — they are the identity.

### 1. The human is at the center, not autonomy

The human starts, steers, and approves at every meaningful step. The precise line is **machine
dispatch is allowed, a machine action is never**: an incoming event may create a visible, gated
work item that does nothing on its own, but no consequential action happens without the human.

Requires:

- Approval gates as a first-class part of the agent contract, not a plugin.
- A human start (a button or a human-initiated event), never a schedule. This is the central
  gesture.
- The **server** executes an approved action; the model only proposes. The guarantee lives in
  code, not in a prompt.
- Full transparency: what the agent did and why, visible and traceable, with history.
- The ability to intervene, stop, or correct at any moment.

Forbids:

- A fully autonomous "fire and forget" mode, even where it is technically possible.
- A consequential action initiated by a machine, or any action without an audit trail.
- An irreversible meaningful action without confirmation — blocked architecturally, even if a
  developer cuts a corner.

### 2. The value is in the thin layer, not the engine

We do not write a runtime and do not compete with the engines — we stand on them. One minimal
contract, `AgentRuntime: run(input) → AsyncIterable<AGUIEvent>`, isolates everything above it from
whichever engine is below.

Requires:

- A minimal `AgentRuntime` contract, kept narrow by discipline.
- AG-UI as the single outward language: every provider translates its own output into it.
- Swappability proven, not declared — at least two unlike providers shipped (Mastra and
  claude-cli), with a conformance suite as the proof the contract did not leak.

Forbids:

- The core knowing any concrete engine (no engine import inside `@platform/core`).
- Becoming an engine — we orchestrate and display, we do not execute ourselves.
- Duplicating engine features; memory, RAG, and tool execution live in the provider layer.

### 3. A hard framework / userland boundary

Thin contracts live in the public SDK; implementations live in userland. An AI agent helps build
those implementations, guided by skills shipped alongside the contracts.

Requires:

- A public SDK of thin contracts (`defineAgent`, `defineTool`, `defineProvider`), versioned by
  semver.
- Discovery by convention: drop a file in the right folder and it is picked up.
- Skills riding inside the packages, versioned with the code they describe (discovered from
  `node_modules`).
- Config-as-data: one typed object behind an adapter, so a future visual editor edits the same
  thing the code does.

Forbids:

- Userland importing from internals — only from the public SDK. The boundary is physical
  (separate packages), not a convention.
- Shipping the core as something to fork and patch instead of a versioned dependency.
- Putting skills or knowledge in a database, where they drift from the code version.

## Two consequences worth stating

**No integrations catalog** (from belief 3). The framework ships no library of pre-built
integrations. Instead it makes building one trivial: a thin contract, skills that teach the agent
your format, and a worked example. When a ready MCP server exists (GitHub, Gmail, Slack), you
connect it; when none does, you write a small one against the contract, guided by the skills. The
bet is that a thin contract plus skills beats a fixed catalog as models get better at writing code.

**The work item, not the instance** (from belief 1). The human can only conduct what they can see,
so the unit of the system is a durable **work item** — it lives, shows its result, and waits for a
human action, closing only when the human closes it. The thing that runs the agent is an ephemeral
**instance**; separating the durable work from the ephemeral executor is what makes the system
conductable. The lifecycle is derived in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Conscious "no"s

- No autonomous mode without a human.
- No agent runtime of our own — use providers.
- No duplicating engine features (memory, RAG, tool execution).
- No skills or knowledge in a database.
- No fork-and-patch model instead of a versioned dependency.
- No userland reaching into core internals.
- No editing code from the consumer view.
- No terminal-spawn in production — claude-cli is local development only; production ships the
  Mastra provider.
- No cloud-for-everyone with PII by default.
- No visual workflow builder, marketplace, or large set of integrations up front — not "never,"
  but "not now," driven by real demand.

## Protected — do not change silently

This philosophy and the architecture invariants ([`ARCHITECTURE.md`](ARCHITECTURE.md), section 0)
define what the framework *is*. Changing a belief, a conscious "no," or an invariant is dangerous
and delicate — it changes the identity of the framework. Such a change requires an explicit warning
to the developer that it is dangerous and their direct confirmation. Never edit these silently.
Backstops: the `guard-foundation-edits` hook and the `check-foundation` skill stage run by any
task.
