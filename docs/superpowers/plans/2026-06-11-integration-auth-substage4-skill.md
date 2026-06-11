# Integration Auth — Sub-stage 4: write-integration skill auth interview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the `write-integration` skill enforce the authentication contract (spec `docs/superpowers/specs/2026-06-11-integration-auth-contract-design.md` §5): the skill determines the `AuthSpec` (STOP and ask the developer if auth is unclear — never guess), names the exact env var, appends it to `.env.example`, scaffolds the `auth` declaration + the credential injection, and forbids the integration from reading secrets itself. Docs-only stage (the skill is a markdown procedure) — no code, no tests, but it must be ACCURATE against the sub-stage 1–3 as-built.

**Branch:** `feat/gmail-viewer`. **PREREQUISITE:** sub-stages 1–3 BUILT (the skill must reference the REAL `AuthSpec`/`ResolvedCredential` API, `atizarEnv` names, `resolveCredential`, the connect flow, and `.env.example`). Read those as-built notes in `HANDOFF.md` before editing the skill, and verify the symbols the skill cites still exist (`grep`).

---

## CONTEXT

The `write-integration` skill (`.claude/skills/write-integration/SKILL.md`) is a Task-genre skill (own a run, has a self-improvement stage). Its "integration contract (FACTS)" block + Stage 2 (Intent gate) already mention auth/credentials in prose (and were lightly touched in email-inbox stage 2 to reference the result-shape contract). THIS sub-stage rewrites the auth parts to match the real auth contract: declare-not-self-read, the open `AuthSpec` kind, the `ATIZAR_` env naming, `.env.example` seeding, and the "stop and ask" rule. Conventions for skills live in `.claude/skills/CONVENTIONS.md`; the agentic decisions (A5 self-contained, A7 consumer skills) in `docs/AGENTIC.md`.

Keep it self-contained (A5 — no external-plugin dependency), English, and registered (it already is). This is a Procedure-vs-Task: `write-integration` is a Task, so its self-improvement stage stays.

---

## TASK 1: rewrite the auth FACTS + add the auth-interview stage

**Files:** Modify `.claude/skills/write-integration/SKILL.md`

- [ ] **Step 1: Read the current SKILL.md fully** + the spec §1/§5 + `HANDOFF.md` sub-stage 1–3 as-built. Confirm the exact symbol names the skill will cite: `AuthSpec` / `ResolvedCredential` / `CredentialResolver` (`@platform/core`), `resolveCredential` / `registerResolver` / `atizarEnv` (`@platform/server`), the env names (`ATIZAR_SECRET_KEY`, `ATIZAR_<PROVIDER>_CLIENT_ID/SECRET`, `ATIZAR_<INTEGRATION>_API_KEY`), and that `.env.example` exists. If any name differs from this plan, use the AS-BUILT name (grep to confirm) — do NOT cite a symbol that doesn't exist.

- [ ] **Step 2: Update the "integration contract (FACTS)" block** — replace the credential-related bullets so they state:
  - **Auth is DECLARED, never self-read.** The integration exports an `auth: AuthSpec` (from `@platform/core`); its functions receive the live credential via `deps.credential` (`ResolvedCredential`). The integration MUST NOT read `process.env` or files for secrets — that is the framework's job (`resolveCredential`).
  - **`AuthSpec.kind` is open:** `none` / `apiKey` / `oauth2` are built-in (framework resolvers); a custom kind ships its OWN `CredentialResolver` registered via `registerResolver(kind, fn)` in userland — **never edit `@platform/core`** to add an auth method.
  - **Env naming:** official vars are `ATIZAR_`-prefixed and read via `atizarEnv` (`ATIZAR_<INTEGRATION>_API_KEY` for apiKey; `ATIZAR_<PROVIDER>_CLIENT_ID/SECRET` for oauth2's app registration). Vendor vars (e.g. `ANTHROPIC_API_KEY`) are NOT namespaced.
  - **`.env.example`:** every required secret gets an empty, commented line in the repo-root `.env.example` (what it is + where to get it). The skill ADDS the integration's block there.
  - **`checkCredentials`/health** becomes "does `resolveCredential` yield a usable credential?" (the F3 health surface consumes it).

- [ ] **Step 3: Rewrite Stage 2 (the Intent gate) into an explicit AUTH INTERVIEW** — add, as a mandatory gate:
  > **Determine the AuthSpec. If you cannot tell from the service's docs or the developer's description HOW authentication works, STOP and ask the developer — never guess.** Establish: the `kind`; for `oauth2` the provider + exact scopes (ask if unstated); for `apiKey` the env var name it reads (`ATIZAR_<INTEGRATION>_API_KEY`); for a custom kind, that the integration ships its own `CredentialResolver` (scaffold a stub, explain it registers in userland, not core). State the exact env var name(s) out loud and confirm you will add them to `.env.example`.

- [ ] **Step 4: Update Stage 3 (TDD loop) + Stage 4 (exports)** so the scaffold includes: an `auth.mjs`/`auth.d.ts` (or an `auth` export) declaring the `AuthSpec`; functions taking `deps.credential` (generalize the old `deps.getClient` note); and **a step that appends the env block to `.env.example`**. Add to Stage 6 (Validate) a check: "grep the integration for `process.env`/file reads of secrets — there must be NONE (auth is injected)."

- [ ] **Step 5: Update the exemplar pointer** — the worked example is now the rewritten `gmail` integration (sub-stage 5). Until that lands, point at the spec; after sub-stage 5, point at `packages/integrations/src/gmail/`. (Add a note: "exemplar = `gmail` once sub-stage 5 lands.")

- [ ] **Step 6:** verify the skill stays self-contained (no superpowers dependency), English, under ~500 lines. `npx prettier --check` is not run on `.md` skills necessarily — but keep it clean.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/write-integration/SKILL.md
git commit -m "docs(skills): write-integration auth interview — declare-not-self-read, stop-and-ask, .env.example (auth sub-stage 4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK 2: update the gmail-viewer consumer skill + AGENTIC + HANDOFF

**Files:** Modify `packages/integrations/skills/gmail-viewer/SKILL.md`, `docs/AGENTIC.md`, `HANDOFF.md`

- [ ] **Step 1:** the gmail-viewer consumer skill's credentials section currently documents hand-placed `~/.gmail-mcp/` files. Update it to the new model: "credentials come from the in-app Connect flow (OAuth), stored encrypted; the developer sets `ATIZAR_GOOGLE_CLIENT_ID/SECRET` (the app registration) + `ATIZAR_SECRET_KEY`; the per-user token is obtained by clicking Connect, NOT by placing files." (NOTE: if sub-stage 5 deletes gmail-viewer in favor of a unified `gmail`, this skill moves/rewrites there — coordinate; for THIS sub-stage, update whichever gmail skill exists. If sub-stage 5 runs right after, you may defer this to sub-stage 5 — note the choice.)

- [ ] **Step 2:** `docs/AGENTIC.md` — note the `write-integration` skill now enforces the auth contract (declare-not-self-read + stop-and-ask + `.env.example`), under the integration track.

- [ ] **Step 3:** `HANDOFF.md` — "Sub-stage 4 ✅ BUILT — write-integration auth interview (stop-and-ask, declare-not-self-read, env naming + `.env.example`). Next = sub-stage 5 (gmail rewrite via the updated skill = the end-to-end validation)."

- [ ] **Step 4: Commit** (exact paths).

```bash
git add packages/integrations/skills/gmail-viewer/SKILL.md docs/AGENTIC.md HANDOFF.md
git commit -m "docs: gmail consumer skill + AGENTIC/HANDOFF reflect the auth contract in write-integration (auth sub-stage 4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## SELF-REVIEW NOTES

- Docs-only; the risk is citing a symbol that doesn't match sub-stage 1–3 as-built — Task 1 Step 1 forces a grep-confirm before writing.
- The "stop and ask" rule is the user's explicit requirement (2026-06-11) — it is a mandatory gate, not advice.
- The skill names the exact env var + seeds `.env.example` (user requirement) — Steps 3–4.
- Coordinate the gmail consumer-skill update with sub-stage 5 (which may delete/rewrite gmail-viewer) — flagged, not assumed.
