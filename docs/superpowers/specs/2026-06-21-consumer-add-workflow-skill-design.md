# Consumer `add-workflow` Skill — Design

**Status:** Design approved in brainstorming (2026-06-21). This is the **handoff artifact** — implementation
is intended for a fresh agent/session (this design session is long). Read this top-to-bottom before
implementing.

**One-line goal:** A consumer-facing, staged `add-workflow` skill that ships **inside an `@atizar/*` npm
package**, is **discovered in a consumer's project via `skills-npm`**, and walks a user from "I want a
workflow that does X" to a typechecked, tested, browser-verified workflow **plus a co-located README** that
explains what the workflow is, how to run it, and which credentials it needs.

---

## 0. Context: who this is for, and the "twin"

There are **two** `add-workflow` skills, by audience:

- **Dev / L1 (already BUILT):** `.claude/skills/add-workflow/` — the capstone from beta unit U7, 13 stages,
  **repo-local**. It references this repo's internals (`apps/inbox/workflows/email-inbox` as the exemplar,
  the three aggregators by path, internal conventions). It is for an agent **developing the framework
  itself**.
- **Consumer / L2 (THIS spec):** the lighter **twin**, for someone who installed the published `@atizar/*`
  packages and is building a workflow in **their own project**. It teaches the **public SDK** only
  (`@atizar/core` / `@atizar/server` / `@atizar/react`), assumes **no knowledge of this repo**, and is
  **self-contained** (no dependency on superpowers or any external plugin — `docs/AGENTIC.md` A5).

"Twin" = same purpose (scaffold a workflow), two audiences. AGENTIC.md always framed the consumer skills as
"the L1 twin, rewritten for an audience that has NOT read this repo."

**AGENTIC.md correction (do this as part of the work):** A6/Phase-3 assumed Claude Code auto-discovers
skills in `node_modules` and cited `skills-npm` as that mechanism. Verified 2026-06-21: **Claude Code does
NOT scan `node_modules`** (it reads `.claude/skills/`, `~/.claude/skills/`, and installed plugins). `skills-npm`
(antfu) is a real **third-party bridge** that symlinks node_modules-package skills into `.claude/skills/` — it
is the chosen distribution path here, but it is NOT native auto-discovery. Update AGENTIC.md A6/Phase-3 to
state this precisely (skills-npm = third-party symlink bridge; plugin+marketplace = the official-but-separate
alternative, deferred).

---

## 1. Distribution: how the skill reaches a consumer (`skills-npm`)

**Publisher side (us):**
- Place the skill at `packages/core/skills/add-workflow/SKILL.md` (+ optional `references/`). `@atizar/core` is
  the host package because every framework consumer installs it.
- Add `"skills"` to `@atizar/core`'s `package.json` `"files"` array so the folder ships in the npm tarball.
  (npm publishes only `files` + defaults — without this the skill is not in the package.)
- The skill is versioned with the code (drift-free by construction).

**Consumer side (verified mechanism, antfu/skills-npm):**
- They install `@atizar/core` (for the code) — it carries `skills/add-workflow/SKILL.md`.
- One-time: `npm i -D skills-npm` then `npx skills-npm setup`. `setup` adds `"prepare": "skills-npm"` to their
  `package.json`, adds a `.gitignore` entry, and runs the first sync.
- On every `npm install`, the `prepare` hook runs `skills-npm`, which scans `node_modules/**/skills/*/SKILL.md`
  and **symlinks** discovered skills into `.claude/skills/` (e.g. `.claude/skills/npm-atizar-core-add-workflow`).
- Claude Code (which DOES read `.claude/skills/`) then sees the skill; the user invokes it (e.g.
  `/add-workflow`). It re-syncs with the package version automatically on install.
- Optional `skills-npm.config.ts` in the consumer root controls `source`/`agents`/`include`/`exclude`.

**Out of scope here (deferred):** shipping as a Claude Code plugin + marketplace (the official-but-separate
channel). The publisher layout (`skills/<name>/SKILL.md`) is compatible with both, so the plugin channel can be
added later from the same files without rework.

---

## 2. Starter assumption (first cut) + flexibility

For the first version the skill assumes the **demo-app layout** (`apps/inbox`-style): a server entry that calls
`createServer`, a client that mounts the board, and the **three aggregators** at known paths
(`workflows/index.ts`, `server/workflows.ts`, `client/workflows.ts`). Fixed paths = the skill knows exactly
where to write files and how to wire, which keeps it simple and deterministic.

**Flexibility (deliberately deferred, not precluded):** the fixed layout is a *default*, not a cage. Future
varied workflows are just different file sets inside their own `workflows/<id>/` folder — same skill shape. If a
consumer's layout differs, a later version can ask where things live. A standalone clean starter-template repo
is also deferred. The first cut targets the demo-app layout; the skill must `log`/state this assumption so a
consumer on a different layout isn't silently misled.

---

## 3. The staged skill (Task genre, like superpowers / teachers-web `bug-fixing`)

A **Task** skill (`.claude/skills/CONVENTIONS.md` genre): owns the run end-to-end, staged, gated at boundaries,
TDD-red-first, browser-verified, ends with self-improvement. Lighter than the 13-stage dev twin, but with clear
named stages. **Self-contained** — every stage's procedure is inlined (no superpowers dependency).

- **Stage 0 — Preflight (probe, don't ask).** Read the public-SDK signatures the skill will call
  (`defineWorkflow`/`defineAgent`/`definePrompt` from `@atizar/core`; `ServerBinding`/effects from
  `@atizar/server`; render/HITL specs from `@atizar/react`) and one worked example. Confirm the project is in
  the assumed starter layout (the three aggregators exist). **Read the local self-improvement notes file**
  (§5) so accumulated learnings inform this run.

- **Stage 1 — Intent [GATE].** In ONE message, confirm with the user: workflow **id / label / icon**; the
  **agent roster** (which agent is the `input` — the human-started entry — and which are `worker`s); each
  agent's **tool surface** (read tools → `readonly`; surface/render tools; the proposal/approval tool →
  `approvals` + `effects`; any `dispatch` tool); **where the human gate is** (= the irreversible action); the
  **integrations + credentials** each needs; the **rerun/reset** policy. Wait for confirmation before writing.

- **Stage 2 — Integrations & credentials.** For each external service: reuse an existing integration or write a
  new one (point at the `@atizar/integrations` contract / the integration pattern). Establish the credentials
  needed, declare them as `ATIZAR_*` env vars, seed `.env.example`, and **ask the user for real credentials**
  needed for the later browser-verify.

- **Stage 3 — Scaffold + wire.** Create `workflows/<id>/` (ids/contracts/tools/cards consts, `definePrompt`
  blocks, the structure-only `defineWorkflow`/`defineAgent` descriptor, the `ServerBinding` + effects, the
  client render/HITL specs) **against the public SDK**, then wire the three aggregators (one line each).

- **Stage 4 — Tests-first → green.** Write the drift-guard + behavior tests **RED first**, then implement to
  pass. Gate: `typecheck && test && lint && format` all green. (Lesson carried from the framework build:
  include **eslint**, not just prettier, in the per-task verify.)

- **Stage 5 — Browser-verify [GATE].** Drive the flow in the real running app: START the input agent → a
  dispatch spawns a worker → open it → its card renders → run the **HITL approval** end-to-end (approve →
  server effect → finished). One flow is not "done" — verify the approval path. Reserve "verified" for what
  actually ran in the browser.

- **Stage 6 — 📄 Workflow doc (co-located).** Write **`workflows/<id>/README.md`** so the workflow is
  self-explaining when deployed. Required contents:
  - **What it is** — one line + what the workflow decides/does.
  - **Agents & roles** — which is the input (startable) agent, which are workers.
  - **How to run** — which agent to start and how (button/trigger), `yarn dev` → where it appears.
  - **Credentials / integrations** — which services + which `ATIZAR_*` env vars are required.
  - **Gates** — what the human approves (the irreversible action).

  This is a first-class output, not optional: deploying e.g. `inbox` lets the user (or an agent) read/ask "what
  is this workflow and how do I run it" directly from this file. No separate query-skill is needed — Claude
  reads this README when asked.

- **Stage 7 — Self-improvement (local, silent-skip default).** The packaged skill is read-only in
  `node_modules` — it MUST NOT try to edit itself. Instead, if something systemic surfaced (the user corrected
  the same thing twice; a stage didn't match the project), append a short, dated note to a
  **consumer-project-local** file (§5). If nothing systemic surfaced, write one sentence and exit. Stage 0
  reads this file on future runs, so the skill **learns in the consumer's project** without mutating the
  package.

---

## 4. Foundation / boundary notes

- **I5 (framework/userland boundary):** the consumer skill teaches the **public SDK only**; it must reference
  no `@atizar/*` internal paths. Its worked examples use the public contracts and the consumer's own
  `workflows/<id>/` layout.
- **No consequential surprises:** the skill scaffolds code and asks for credentials; it never sends/executes a
  real outward action on the user's behalf beyond the gated, browser-verified flow the user drives.
- **Self-contained (A5):** no dependency on superpowers or any external plugin; stages are inlined.

---

## 5. The local self-improvement notes file

- **Path (consumer project):** `.claude/atizar/add-workflow-notes.md` (created on first systemic finding;
  absent is fine).
- **Format:** append-only, dated one-liners — what recurred + the systemic adjustment, each quoting the
  motivating incident briefly. Human- and agent-readable.
- **Read at Stage 0, written at Stage 7.** The packaged `SKILL.md` stays immutable; learnings accumulate here,
  local to the consumer's project, where their agent can see them on the next run.
- **Why not edit the skill:** it lives in `node_modules` (read-only; overwritten on package update) — edits
  would be lost and would fight the versioned-with-code guarantee.

---

## 6. Out of scope / deferred (YAGNI)

- A standalone clean **starter-template repo** (first cut targets the demo-app layout).
- The **plugin + marketplace** distribution channel (same publisher files; add later if needed).
- **Layout flexibility** beyond the assumed three-aggregator layout (a later version can ask where files go).
- A separate **"explain my workflows" query-skill** (the co-located README + Claude reading it covers "what is
  this / how to run").
- Full **token-budget / multi-workflow** concerns — this skill scaffolds one workflow per run.

---

## 7. Acceptance

- The skill exists at `packages/core/skills/add-workflow/SKILL.md`, ships via `@atizar/core`'s `files`, and is
  discovered by `skills-npm` in a consumer project (symlinked into `.claude/skills/`).
- Running it produces a working workflow in the demo-app layout: scaffolded files against the public SDK, the
  three aggregators wired, tests green (typecheck/test/lint/format), the HITL flow **browser-verified**, AND a
  co-located `workflows/<id>/README.md` with what/how-to-run/credentials/gates.
- The self-improvement stage writes to the consumer-local notes file (never to the packaged skill), and
  preflight reads it.
- `docs/AGENTIC.md` A6/Phase-3 corrected (skills-npm = third-party symlink bridge; no node_modules
  auto-discovery; plugin channel = deferred alternative).
