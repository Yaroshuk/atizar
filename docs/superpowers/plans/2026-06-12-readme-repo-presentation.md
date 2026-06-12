# README & repo presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a hook-in-10-seconds, honest, accurate `README.md` plus the supporting repo files (`LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `assets/`) for atizar's open-source launch.

**Architecture:** Pure documentation work. The README is one file assembled section by section per the approved skeleton; each task writes a concrete markdown block then verifies it (render + link + an "honesty grep" that fails if a forbidden false claim slips in). Parts that depend on unbuilt work (the `DEMO=1` quick-start command, the `@platform/*→@atizar/*` rename, the demo GIF) are written as honest placeholders, gated behind `[Status]`. A draft-guard HTML comment at the top of the README prevents premature publish.

**Tech Stack:** Markdown, GitHub-flavored. Optional verification tools: `grep`, `npx markdownlint-cli2` (if present), GitHub preview.

**Source of truth:** `docs/superpowers/specs/2026-06-12-readme-repo-presentation-design.md`. Honesty constraints there are binding: no present-tense claim for anything unbuilt; no statement contradicting a locked decision (no SQLite, no pgvector, no CopilotKit); `@atizar/*` names only with the draft-guard note; quick-start command finalized only after `DEMO=1` runs.

---

## Files

- Create: `README.md` — the centerpiece.
- Create: `LICENSE` — MIT (decided).
- Create: `CONTRIBUTING.md` — short, standard + agentic-first note.
- Create: `SECURITY.md` — short responsible-disclosure pointer.
- Create: `assets/` — holds `atizar-mark.svg` (the icon, **user-provided input**).
- Reference only (do not edit): `docs/ARCHITECTURE.md`, `docs/PHILOSOPHY.md`, `apps/inbox`, the spec.

**Honesty grep (used in several tasks):** the following must return **no matches** in `README.md` (case-insensitive), because each would be a false claim or a contradiction of a locked decision:

```bash
grep -niE 'sqlite|pgvector|copilotkit|npm install atizar|atizar\.io' README.md
```

Expected: no output. (CopilotKit was removed at step 6; SQLite/pgvector are never used; npm package + website are not live.)

---

### Task 1: Scaffold — assets, draft-guard, LICENSE

**Files:**
- Create: `assets/.gitkeep` (until the icon arrives) and place `assets/atizar-mark.svg`
- Create: `LICENSE`
- Create: `README.md` (draft-guard header only, content added in later tasks)

- [ ] **Step 1: Confirm the icon inputs (already provided)**

The hero uses two user-provided icons (flame/diamond mark in the brand orange `#e6562e`/`#f4a23c`):
`assets/atizar-mark.svg` (cream bg `#f1e4d2`, dark stroke → **light theme**) and `assets/atizar-dark.svg`
(dark bg `#1f140e`, cream stroke → **dark theme**). Confirm both are present:

```bash
ls -la assets/atizar-mark.svg assets/atizar-dark.svg
```

Expected: both files present (~637 bytes each). They are already in the tree — do NOT regenerate or alter them.

- [ ] **Step 2: Write `LICENSE` (MIT)**

```
MIT License

Copyright (c) 2026 Atizar contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: Create `README.md` with only the draft-guard header**

```markdown
<!--
  DRAFT — do not publish/merge to a public default branch until:
  (1) the DEMO=1 quick-start command lands (see docs/superpowers/specs/2026-06-12-demo-mode-zero-cred-design.md),
  (2) the @platform/* → @atizar/* rename is done,
  (3) the approval-gate demo GIF is recorded.
  Design: docs/superpowers/specs/2026-06-12-readme-repo-presentation-design.md
-->
```

- [ ] **Step 4: Verify files exist**

```bash
ls -la LICENSE README.md assets/
```

Expected: all three present; README contains only the HTML comment.

- [ ] **Step 5: Commit**

```bash
git add README.md LICENSE assets/
git commit -m "docs(readme): scaffold README draft-guard, MIT LICENSE, assets dir"
```

---

### Task 2: Hero + manifesto + the wedge (above the fold)

**Files:**
- Modify: `README.md` (append after the draft-guard comment)

- [ ] **Step 1: Append the hero, manifesto opening, and wedge**

````markdown

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/atizar-dark.svg" />
  <img alt="Atizar" src="assets/atizar-mark.svg" width="120" />
</picture>

# Atizar

**Developer builds. Human directs. Agent runs.**

*Don't light a fire and walk away. Tend it.*

An open-source TypeScript framework for building agentic automations — agentic-first, human-in-the-loop.

[![License: MIT](https://img.shields.io/badge/License-MIT-e6562e.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-e6562e.svg)](https://www.typescriptlang.org/)
[![Status: beta](https://img.shields.io/badge/status-beta-e6562e.svg)](#status)

[Quick start](#quick-start) · [How it works](#how-it-works) · [Concepts](#core-concepts) · [Philosophy](docs/PHILOSOPHY.md) · [Contributing](CONTRIBUTING.md)

</div>

<!-- TODO: approval-gate demo GIF here once DEMO=1 lands -->

---

Autonomous agents are easy to start and hard to trust. The moment one touches your inbox, your data, or your money, "fire and forget" stops being a feature and starts being a liability.

**Atizar keeps a human's hand on the poker.** The agent does the work — reads, drafts, proposes — and a person approves every step that matters. The approved action is run by the server, never by the model. Everything is audited.

The name is the Spanish verb *atizar* — to stoke a fire that's already burning. That's the whole idea: the agent is the fire, you're the one tending it.

### Two views of one pipeline.

Developers want code. The people who run it want a UI. So atizar gives each its own:

- **Developer → code.** Real TypeScript, no node canvas.
- **Consumer → a clean UI.** Cards and buttons, never your codebase.

### Agentic-first — coated in skills.

No 400-node marketplace. Ask, and your coding agent writes the integration in ~10 minutes. You describe, it builds.

### The model never acts.

The agent proposes, the human approves, the server executes — every action audited.
````

- [ ] **Step 2: Honesty grep**

```bash
grep -niE 'sqlite|pgvector|copilotkit|npm install atizar|atizar\.io' README.md
```

Expected: no output.

- [ ] **Step 3: Render check**

Open `README.md` in a GitHub-flavored markdown preview (VS Code preview or push to a draft branch). Verify: centered hero, badges render orange, the three wedge headings read as a pitch. Confirm the icon shows (or a broken-image placeholder if the SVG isn't in yet — note it).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): hero, manifesto opening, and the three-point wedge"
```

---

### Task 3: See it work + Quick start (the gated parts)

**Files:**
- Modify: `README.md` (append)

- [ ] **Step 1: Append the demo and quick-start sections**

The quick start is **gated** — the real one-command path needs `DEMO=1`, which is not built. Write honest placeholder language plus the smallest real `defineAgent` snippet (accurate to `docs/ARCHITECTURE.md §3`).

````markdown

## See it work

<!-- TODO: GIF — agent board → thread → approval-gate card → approve → action executed & audited -->
<!-- TODO: side-by-side — a defineAgent snippet next to the clean operator UI -->

*Demo media lands with the zero-credential demo mode — see [Status](#status).*

## Quick start

> **Beta.** A zero-credential demo mode is landing: it runs entirely on an in-process database and a mock agent — no Docker, no API keys. The one-command quick start will appear here when it ships ([status](#status)).

The smallest thing you write looks like this:

```ts
import { defineAgent } from '@atizar/core'

export const reply = defineAgent({
  id: 'reply',
  name: 'Reply',
  role: 'worker',
  provider: 'claude-cli',                    // a name in the provider registry
  instructions: 'Draft a reply to the latest email.',
  readonly: ['get_latest_email'],            // pure reads, no side effects
  tools: ['get_latest_email', 'saveDraft'],
  approvals: ['saveDraft'],                  // opens a gate — pauses for a human
  effects: ['saveDraft'],                    // the SERVER runs this once approved
  renders: { saveDraft: 'ApprovalDialog' },  // tool name → UI component
})
```

The agent drafts a reply and proposes it; the human approves; the server saves the draft. The model never sends anything on its own.
````

- [ ] **Step 2: Verify the snippet matches the real contract**

Cross-check every field against `docs/ARCHITECTURE.md` section 3 (the `defineAgent` example):

```bash
grep -nA14 'defineAgent({' docs/ARCHITECTURE.md | head -20
```

Expected: fields `id, name, role, provider, instructions, readonly, tools, approvals, effects, renders` all present in the doc — confirming the README snippet is accurate, not invented.

- [ ] **Step 3: Honesty grep**

```bash
grep -niE 'sqlite|pgvector|copilotkit|npm install atizar|atizar\.io' README.md
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): see-it-work placeholders + gated quick start with real defineAgent snippet"
```

---

### Task 4: How it works (architecture) + Core concepts

**Files:**
- Modify: `README.md` (append)

- [ ] **Step 1: Append the architecture diagram and concepts**

The diagram must be accurate: swappable runtime (Mastra prod / claude-cli dev), Postgres state, server-executed effects, AG-UI → React, two views. No CopilotKit, no SQLite, no pgvector.

````markdown

## How it works

Atizar is a thin layer, not another engine. You bring an agent runtime; atizar gives it a spine and two faces.

```
  Developer code + config        defineAgent / defineWorkflow  (TypeScript)
            │
            ▼
  Swappable runtime              Mastra (production)  ·  claude-cli (dev)
            │
            ▼
  Server spine                   Postgres state · server-executed effects · audit ledger
            │
            ▼
  AG-UI events  ───────────────▶ React UI — two views:
                                   code for the developer · a clean UI for the operator
```

The core knows no concrete engine. Swap the runtime without rewriting your workflows — a provider **conformance suite** proves the contract holds across both.

## Core concepts

- **Human-in-the-loop is a first-class gate.** Approvals are part of the agent contract (`approvals`), not a bolted-on callback. No consequential action runs without a human's yes.
- **The model proposes, the server executes.** On approval the *server* runs the effect through an action ledger (keyed `workItemId + gateId`), exactly once. The model never holds the trigger.
- **Two views from one config.** A single validated config drives both faces: the developer edits code; the operator edits only declared leaf fields (prompt, name) through the UI.
- **Agentic-first: skills ride inside the packages.** Knowledge ships *with* the code it describes, so your coding agent reads it to extend the framework instead of guessing.
- **Integrations on demand.** No marketplace. The `write-integration` skill walks an agent through a new integration in minutes (the Gmail integration was built this way).
- **Swap the runtime, keep the code.** Providers (Mastra, claude-cli, a test mock) sit behind one `AgentRuntime` contract — proven, not just declared, by the conformance suite.
````

- [ ] **Step 2: Honesty grep**

```bash
grep -niE 'sqlite|pgvector|copilotkit|npm install atizar|atizar\.io' README.md
```

Expected: no output.

- [ ] **Step 3: Verify concept claims against the invariants**

```bash
grep -niE 'I9|server.executes|conformance|config-as-data|skills' docs/ARCHITECTURE.md | head
```

Expected: matches confirming server-executed effects (I9), conformance suite (I4), config-as-data (I7), skills-in-packages (I6) are real invariants — the concepts section paraphrases them, not invents.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): how-it-works diagram + core concepts (accurate to invariants)"
```

---

### Task 5: Flagship example + What's included (packages)

**Files:**
- Modify: `README.md` (append)

- [ ] **Step 1: Append the flagship example and the package table**

Package names use `@atizar/*` (final), valid only behind the draft-guard until the rename. Descriptions match the real `@platform/*` split.

````markdown

## The flagship example: an inbox

The canonical workflow ships in [`apps/inbox`](apps/inbox): email or leads come in → an agent **qualifies** them → it **drafts** a reply or proposes actions → a human **approves** → the server acts (saves the draft, applies the labels). It runs on both providers and is the best place to see every concept above working together.

## What's included

| Package | What it is |
|---|---|
| `@atizar/core` | The isomorphic contract: `defineAgent`, the message layer, the provider interface, gates. React- and Node-free. |
| `@atizar/providers` | Agent runtimes behind one interface: Mastra, claude-cli, and a mock for tests. |
| `@atizar/integrations` | Batteries (e.g. Gmail) as injectable functions + read-only MCP wrappers. |
| `@atizar/server` | The server spine: Postgres-authoritative state, the dispatch chokepoint, server-executed effects, SSE. |
| `@atizar/react` | The UI: board, thread, approval gates, and the card-construction kit. |
````

- [ ] **Step 2: Verify package descriptions against CLAUDE.md**

```bash
grep -nE '@platform/(core|providers|integrations|server|react)' CLAUDE.md HANDOFF.md | head
```

Expected: matches confirming the five packages and their roles exist as described.

- [ ] **Step 3: Honesty grep**

```bash
grep -niE 'sqlite|pgvector|copilotkit|npm install atizar|atizar\.io' README.md
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): flagship inbox example + package map"
```

---

### Task 6: Status + Roadmap

**Files:**
- Modify: `README.md` (append)

- [ ] **Step 1: Append an honest Status and Roadmap**

"Workflows that learn" goes here, clearly marked *planned — not built*.

````markdown

## Status

**Beta — building in the open.** The framework is validated end-to-end in the browser: the server spine (Postgres-authoritative state, server-executed effects, Stop/cancel), both providers (Mastra + claude-cli) behind one conformance-tested contract, the Gmail integration on an OAuth credential contract, and the operator UI (board, thread, approval gates, activity & trace log).

Not done yet: the zero-credential demo mode, the `@platform/* → @atizar/*` scope rename, an npm release, and a golden-set eval per workflow. APIs may still shift. Stars and feedback are very welcome.

## Roadmap

- **Zero-credential demo** (`DEMO=1`) — in-process Postgres (PGlite) + a mock provider + synthetic fixtures, so anyone can try it with one command and no keys.
- **Workflows that learn** *(planned — not built yet).* A direction we're designing toward: the agent improves from how you correct it, without fine-tuning. Two channels — implicit few-shot memory from past corrections, and explicit rules a distiller proposes and **you approve**. The model never changes, only the context it receives.
- **Packaging** — the `@atizar/*` scope rename, an npm release, a shared bearer token on mutation routes, and per-workflow golden-set evals.
````

- [ ] **Step 2: Verify the "what works" claims are real (not aspirational)**

```bash
grep -niE 'BUILT & browser-verified|server-executed effects|conformance|OAuth' HANDOFF.md | head
```

Expected: matches confirming the listed "what works today" items are actually built & browser-verified — so Status is honest.

- [ ] **Step 3: Honesty grep**

```bash
grep -niE 'sqlite|pgvector|copilotkit|npm install atizar|atizar\.io' README.md
```

Expected: no output. (`pgvector` intentionally NOT used — the learning roadmap item says only "in-process Postgres (PGlite)"; the memory-store tech is left unspecified, since it isn't built.)

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): honest beta status + roadmap (workflows-that-learn marked not-built)"
```

---

### Task 7: Docs & community + Contributing + License + footer

**Files:**
- Modify: `README.md` (append)

- [ ] **Step 1: Append the closing sections**

````markdown

## Docs & community

- [Architecture](docs/ARCHITECTURE.md) · [Philosophy](docs/PHILOSOPHY.md)
- Examples: the [inbox workflows](apps/inbox)
- Questions & ideas: open a GitHub Discussion or Issue.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Atizar is agentic-first by design: the skills shipped inside each package guide you — and your coding agent — when you extend the framework or add an integration. That's the intended way in.

## License

[MIT](LICENSE) © Atizar contributors. Security disclosures: [SECURITY.md](SECURITY.md).

<div align="center">
<sub>atizar — to stoke a fire. Keep it alive.</sub>
</div>
````

- [ ] **Step 2: Link check**

Verify every relative link resolves:

```bash
for p in docs/ARCHITECTURE.md docs/PHILOSOPHY.md apps/inbox CONTRIBUTING.md SECURITY.md LICENSE; do
  [ -e "$p" ] && echo "OK  $p" || echo "MISSING  $p"
done
```

Expected: `docs/ARCHITECTURE.md`, `docs/PHILOSOPHY.md`, `apps/inbox`, `LICENSE` = OK. `CONTRIBUTING.md` / `SECURITY.md` = MISSING until Task 8 (acceptable now; re-run after Task 8).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): docs/community, contributing, license, footer"
```

---

### Task 8: CONTRIBUTING.md + SECURITY.md

**Files:**
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`

- [ ] **Step 1: Write `CONTRIBUTING.md`**

```markdown
# Contributing to Atizar

Thanks for your interest. Atizar is in **beta, building in the open** — issues, discussions, and PRs are all welcome.

## The agentic-first way in

Atizar ships **skills inside its packages** — versioned knowledge the framework's own coding agent reads. They are the fastest way to contribute correctly:

- Adding an integration? Start from the `write-integration` skill.
- Extending a workflow or the server spine? Read the skills in the relevant package before changing code.

Point your coding agent at them; they encode the conventions this repo enforces.

## Local development

- Yarn-classic (1.22) workspace. Install with `yarn install` (add `--ignore-engines` on older Node).
- `yarn dev` — runs the demo app (server on `:4000`, client on `:5173`).
- `yarn test` — vitest across the workspace.
- `yarn typecheck` · `yarn lint` · `yarn format:check` — keep all green before a PR.
- Dev state runs on **Postgres in Docker** (`docker compose up -d postgres`); the dev server runs on the host.

## Pull requests

- One focused change per PR; keep tests, typecheck, and lint green.
- Follow the existing code style (see `docs/CONVENTIONS.md`).
- Describe what you changed and how you verified it.

## Conduct

Be kind and constructive. Harassment of any kind is not tolerated.
```

- [ ] **Step 2: Write `SECURITY.md`**

```markdown
# Security Policy

Atizar is in beta. We take security seriously and appreciate responsible disclosure.

## Reporting a vulnerability

Please do **not** open a public issue for a security problem. Instead, report it privately via
GitHub's "Report a vulnerability" (Security advisories) on this repository. We'll acknowledge
your report and work with you on a fix and disclosure timeline.

## Scope notes

- Credentials are stored encrypted at rest; API keys live in environment variables, never in the
  database or git.
- The framework's design keeps consequential actions behind human-approved, server-executed gates
  — but beta software carries risk. Do not connect production accounts you cannot afford to expose.
```

- [ ] **Step 3: Verify and re-run the Task 7 link check**

```bash
for p in CONTRIBUTING.md SECURITY.md; do [ -e "$p" ] && echo "OK  $p" || echo "MISSING  $p"; done
```

Expected: both OK.

- [ ] **Step 4: Commit**

```bash
git add CONTRIBUTING.md SECURITY.md
git commit -m "docs: add CONTRIBUTING (agentic-first) and SECURITY policy"
```

---

### Task 9: Final verification pass

**Files:**
- Review: `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`

- [ ] **Step 1: Full honesty grep (the binding constraint)**

```bash
grep -niE 'sqlite|pgvector|copilotkit|npm install atizar|atizar\.io|fine-tun' README.md
```

Expected: **no output.** Any match is a false claim or a contradiction of a locked decision — fix before proceeding. (`fine-tun` guards against the learning-section accidentally implying tuning; it should only ever appear as "without fine-tuning", so if it matches, confirm the surrounding text says *without*.)

- [ ] **Step 2: Verify against the spec's reject-list**

Re-read `docs/superpowers/specs/2026-06-12-readme-repo-presentation-design.md` "What we borrow … and what we reject". Confirm none of the rejected items (learning-as-present-feature, the invented `atizar(agent, {...})` API, SQLite, pgvector, CopilotKit, live npm/website, "thin wrapper over n8n") appear in the README. The `atizar(agent, ...)` API in particular must NOT be present — the only code snippet is `defineAgent`.

```bash
grep -nE 'onApproval|onPause|onCorrect|atizar\(agent' README.md
```

Expected: no output.

- [ ] **Step 3: Markdown lint (if available)**

```bash
npx --yes markdownlint-cli2 "README.md" "CONTRIBUTING.md" "SECURITY.md" 2>/dev/null || echo "markdownlint not available — do a manual GitHub preview instead"
```

Expected: no errors, or the fallback message.

- [ ] **Step 4: Full render review**

Push the branch and view the README on GitHub (or use a local GFM previewer). Walk the spec skeleton top to bottom: hero → manifesto → wedge → see-it-work → quick start → how-it-works → concepts → flagship → packages → status → roadmap → docs/contributing/license → footer. Confirm it reads as "hook in 10 seconds, informative right after," the icon shows, badges are orange, and the diagram is aligned in monospace.

- [ ] **Step 5: Confirm the draft-guard is still present**

```bash
head -8 README.md | grep -q 'DRAFT — do not publish' && echo "guard present" || echo "GUARD MISSING — re-add it"
```

Expected: `guard present`. (The guard stays until DEMO=1 + rename + GIF are done.)

- [ ] **Step 6: Final commit**

```bash
git add README.md CONTRIBUTING.md SECURITY.md
git commit -m "docs: final verification pass on README + repo presentation"
```

---

## Post-plan follow-ups (NOT in this plan — tracked for after)

These are the spec's sequencing dependencies; each is its own piece of work:

1. **DEMO=1** lands (separate spec `2026-06-12-demo-mode-zero-cred-design.md`) → replace the gated quick-start placeholder with the real one-command path.
2. **`@platform/* → @atizar/*` rename** → the `@atizar/*` names become real; remove draft-guard line (2).
3. **Record the approval-gate GIF + the two-views screenshot** from the DEMO=1 build (synthetic data only — never real cassette data) → replace the `<!-- TODO -->` media placeholders; remove draft-guard line (3).
4. When all three are done, remove the draft-guard comment entirely and the README is publish-ready.
