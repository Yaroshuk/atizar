# README & repo presentation — design

**Date:** 2026-06-12
**Status:** design (awaiting user review)
**Topic:** the public-facing README and supporting repo files for the open-source launch.

## Goal

Give the repository a first impression that **hooks in 10 seconds and is informative
immediately after**. A visitor (primarily the open-source / GitHub-stars audience) should, in
one screen, understand *what atizar is*, *why it's different*, and *what makes it interesting* —
then find a clear path deeper (quickstart, architecture, philosophy).

Beautiful **and** informative. Manifesto voice, but every emotional line is immediately grounded
in a concrete, verifiable claim. No overselling — our audience is engineers who detect it.

## Audience & priorities

Primary: **OSS community browsing GitHub.** Secondary: AI engineers evaluating it for real use.

Ordering principle (validated against 15 comparable READMEs — Mastra, CopilotKit, Trigger.dev,
Inngest, browser-use, OpenHands, LangGraph, n8n, etc.): **lead with what is genuinely unusual,
then the trust/philosophy layer.**

- HITL alone is now table-stakes (Mastra, CopilotKit, LangGraph all advertise it) — so we do
  **not** lead with HITL. It is our trust layer, presented second.
- Our genuinely distinctive wedges, presented first:
  1. **Two views of one pipeline** — code for the developer, a clean UI for whoever runs it
     (a deliberate rejection of the low-code node-graph, which is clunky for the dev and
     overcomplicated for the user). This is documented in `ARCHITECTURE.md §1`.
  2. **Agentic-first, coated in skills** — no integration marketplace; you ask and the agent
     writes the integration in ~10 minutes via skills shipped inside the packages
     (`write-integration` skill; gmail integration was built this way).

## Locked creative decisions

- **Name meaning is the central device.** *atizar* (Spanish) — to stoke a fire that's already
  burning. The agent is the fire; the human tends it. Woven into the manifesto, not just stated.
- **Slogan:** `Developer builds. Human directs. Agent runs.`
  Reading: the developer authors the automation (today, via chat/agent — that *is* the
  agentic-first message; chat is the new keyboard); the human/operator steers and approves
  (HITL); the agent does the runtime work. No contradiction with agentic-first — it reinforces it.
- **Manifesto kicker:** *Don't light a fire and walk away. Tend it.*
- **"Zero human code" is framed via the skills mechanism, never as a literal "you write nothing"
  headline.** The defensible, true claim: *you don't hand-write the glue — the framework is
  coated in skills your coding agent uses out of the box; you describe, it builds.*
- **Brand color** `#e6562e` (fire-orange) used in badges and accents.

## What we borrow from the prior draft (and what we reject)

A prior agent produced a well-written draft. We keep its voice and several lines; we **reject**
everything that contradicts the actual codebase or invents features (honesty is non-negotiable —
this audience checks).

**Keep:** the centered `<div align="center">` hero layout; the fire-orange badge color; the
problem-first opening (*"Autonomous agents are easy to start and hard to trust. The moment one
touches your inbox, your data, or your money, 'fire and forget' stops being a feature and starts
being a liability."*); *"keeps a human's hand on the poker"*; the name-in-manifesto integration;
the footer line *"Keep the fire alive."*; a careful nod to EU AI Act human-oversight (as
alignment, **not** a compliance claim).

**Reject (false / not built / contradicts locked decisions):**
- The entire **"Workflows that learn"** subsystem (pgvector, L0–L3 memory layers, few-shot +
  distilled rules) — **not built, not in the architecture.** → moved to **Roadmap** as an honest
  *intent*, clearly marked "not built yet."
- The `atizar(agent, { onApproval, onPause, onCorrect })` quickstart API — **does not exist**
  (built around the invented memory feature). Our real surface is `defineAgent` / `defineWorkflow`
  + the server pipeline + the React UI.
- **"Local dev runs on SQLite with no Docker"** — contradicts the locked decision: dev DB is
  **Postgres in Docker only**; SQLite is **never** used. The zero-cred demo uses **PGlite**
  (Postgres-in-WASM), not SQLite.
- **`pgvector/pgvector:pg16`** in production — we use plain Postgres; no vector extension exists.
- **CopilotKit** in the app — **removed at step 6**; the UI is server-driven over AG-UI.
- `npm install atizar` + `atizar.io` + a "Website" link presented as live — not published yet;
  adjust to the honest status.
- "thin layer that sits on top of the runtime you already use (Mastra, n8n, your own engine)" —
  under-describes atizar (it is a full stack: two views, server-executed effects, a ready UI),
  and n8n is not an agent runtime we wrap.

## README skeleton (section by section)

**0. Hero / above the fold** — centered. Icon (`assets/atizar-mark.svg`) → `# Atizar` → slogan
`Developer builds. Human directs. Agent runs.` → kicker *Don't light a fire and walk away. Tend
it.* → one concrete positioning line (*open-source TypeScript framework for building agentic
automations — agentic-first, human-in-the-loop*) → signal badges (`MIT · TypeScript · build ·
status: beta · ⭐`) in brand orange → nav links (`Quick start · Live demo · Architecture ·
Philosophy · Contributing`) → hero visual **placeholder** (`<!-- TODO: approval-gate GIF -->`).

**1. The manifesto opening** — the problem-first paragraph (borrowed), then the atizar answer +
the name meaning ("the agent is the fire, you tend it"). 2–3 short paragraphs.

**2. The wedge — three compact differentiators** (final, tightened):
> ### Two views of one pipeline.
> Developers want code. The people who run it want a UI. So atizar gives each its own:
> - **Developer → code.** Real TypeScript, no node canvas.
> - **Consumer → a clean UI.** Cards and buttons, never your codebase.
>
> ### Agentic-first — coated in skills.
> No 400-node marketplace. Ask, and your coding agent writes the integration in ~10 minutes.
> You describe, it builds.
>
> ### The model never acts.
> The agent proposes, the human approves, the server executes — every action audited.

**3. See it work — demo.** GIF/screenshots (placeholders for now) of the flow: agent board →
thread → approval-gate card → approve → action executed & audited. Show the **two faces**
side by side (a code snippet next to the clean UI).

**4. Quick start.** Targets the zero-cred **`DEMO=1`** path (see
`2026-06-12-demo-mode-zero-cred-design.md`): clone/`npx` → runs on PGlite + mock provider +
synthetic cassettes, no Docker, no credentials. Then the smallest honest `defineAgent` snippet
showing an approval gate. **Prose written last**, after DEMO=1 actually runs (so it doesn't lie).

**5. How it works — architecture.** Small diagram: developer code + config → swappable runtime
(Mastra prod / claude-cli dev) → server-authoritative Postgres state + server-executed effects →
AG-UI events → React UI (two views). The "thin layer, not an engine" story. **Accurate to the
real layout** (no CopilotKit, no SQLite, no pgvector).

**6. Core concepts — capability-titled H2s** (each a short paragraph + a docs link):
Human-in-the-loop is a first-class gate · The model proposes, the server executes (ledger) · Two
views from one config (config-as-data) · Agentic-first: skills ride inside the packages ·
Integrations on demand (`write-integration`) · Swap the runtime, keep the code (provider contract
+ conformance suite).

**7. The flagship example — inbox.** The canonical workflow (email/leads → qualify → approve →
act) as "build your first automation," linking to a full walkthrough.

**8. What's included — packages.** `@atizar/*` map: `core · providers · integrations · server ·
react`, one line each. (Requires the `@atizar/* → @atizar/*` rename first.)

**9. Status — building in the open / beta.** Honest: what works end-to-end today, what's still
landing (the packaging tail), no public npm release yet. Feedback welcome.

**10. Roadmap.** Honestly-labelled intents, **including "Workflows that learn"** (learning from
human corrections — implicit few-shot + explicit approved rules, no fine-tuning) marked clearly
as *a planned direction, not built.* Plus the remaining beta tail (DEMO mode, scope rename,
golden-set eval, bearer auth).

**11. Docs · Examples · Community.** Links out.

**12. Contributing.** Standard pointer **plus** the agentic-first angle: skills shipped inside the
packages guide you (and your coding agent) when extending the framework.

**13. License · Security · Acknowledgements.** **MIT** (decided 2026-06-12 — simplest for
adoption) · `SECURITY.md` pointer · a nod to Mastra / AG-UI lineage.

**Footer** — centered: name-meaning recap + *Keep the fire alive.* + optional star-history chart.

## Scope — repo presentation beyond the README

In scope, scaled small (the README is the centerpiece):
- `assets/atizar-mark.svg` — the icon the user already has, committed to the repo.
- `LICENSE` — MIT (pending confirmation).
- `CONTRIBUTING.md`, `SECURITY.md` — short, standard; referenced by the README.
- `CODE_OF_CONDUCT.md` — optional; include only if the user wants it.
- GitHub repo metadata (description, topics, social-preview image) — noted, applied at launch.

Out of scope: a marketing website (`atizar.io`); npm publication; the DEMO=1 implementation
itself (its own spec); recording the actual GIF/screenshots (a follow-up once DEMO=1 runs).

## Honesty constraints (hard)

1. No present-tense claim for anything not built (learning layer, npm package, website).
2. No statement contradicting a locked decision (SQLite, pgvector, CopilotKit).
3. Package names shown as `@atizar/*` only after the rename; until then the README is staged but
   not published.
4. The quickstart command is finalized only after DEMO=1 runs locally.

## Dependencies & sequencing

1. **DEMO=1** must run before the Quick start prose is finalized (separate spec already exists).
2. **`@atizar/* → @atizar/*` rename** before the packages section / install commands are real.
3. **GIF/screenshots** recorded after DEMO=1 (synthetic data, safe to publish — never real
   captured cassette data, per the cassette share-safety rule).
4. The README text (everything except the Quick start command and the visuals) can be written
   **now** — it does not block on the above.

## Decided

- **LICENSE: MIT** (decided 2026-06-12). Simplest for adoption; matches Mastra / n8n / most peers.
