# Integration Auth — Sub-stage 5: rewrite the gmail integration on the new contract (validation) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The end-to-end proof of the auth contract + the updated skill (spec `docs/superpowers/specs/2026-06-11-integration-auth-contract-design.md` §6): delete the file-reading gmail integration and rewrite a single `gmail` integration THROUGH the updated `write-integration` skill — it declares `auth: oauth2/google/gmail.modify`, its functions take `deps.credential` (no file/env reads), and re-points lead-inbox + email-inbox onto it. Verified by a browser E2E: Connect Gmail via the button → email-inbox runs on the connected token → a real Gmail action → Disconnect → the agent shows "not connected".

**Branch:** `feat/gmail-viewer`. **PREREQUISITES (all BUILT):** sub-stages 1–4 of integration-auth (the contract, store, `resolveCredential`, the connect flow + UI, the updated skill) AND email-inbox stages 3 + 3b (the workflow exists on claude-cli + Mastra and consumes the CURRENT gmail-viewer). This sub-stage is the migration that flips gmail from file-reading to the auth contract.

**SCOPE NOTE:** this is the riskiest sub-stage because it re-points TWO live workflows (lead-inbox + email-inbox) and BOTH providers (claude-cli + Mastra). Do it in order: build the new `gmail` integration → re-point the server bindings + MCP/Mastra wiring → delete the old → browser-verify both workflows on both providers. Keep the old integration until the new one is verified (atomic swap at the end), OR work behind the contract so a revert is a one-line binding change.

---

## CONTEXT FOR A FRESH AGENT

### What exists today (the thing you are replacing)

- `@platform/integrations/gmail-basic` — `getLatestEmail`, `createDraft`, `checkCredentials` (+ `gmail-client.mjs` that READS `~/.gmail-mcp/*.json` / `GMAIL_OAUTH_*` env).
- `@platform/integrations/gmail-viewer` — `listUnread`, `getEmail`, `markRead`/`trash`/`star` (`modify`), `checkCredentials` (re-export). Read-only MCP wrapper. Also reads files via the shared `gmail-client.mjs`.
- Consumers: **lead-inbox** (qualifier reads via `get_latest_email`; reply effect `createDraft`) and **email-inbox** (sorter `list_unread`; reply `get_email` + `createDraft`; reader/spam/important `markRead`/`trash`/`star` via the `applyEmailActions` effect). Both wired in their `server.ts` bindings + `claude-spawn.ts` MCP config + `mastra/tools.ts`.

### The target

ONE `gmail` integration (merge basic + viewer) built via the updated skill, declaring `auth: { kind:'oauth2', provider:'google', scopes:['https://www.googleapis.com/auth/gmail.modify'] }`, whose functions take `deps.credential` (a `ResolvedCredential` oauth2 → `accessToken`) and build the Gmail client FROM that token (no file/env reads). The MCP wrapper + the server effects + the Mastra tools all obtain the credential via `resolveCredential` (the MCP child resolves it itself using the env passed by `claude-spawn`; the server/Mastra resolve in-process).

### Invariants

- **I2/I9** — mutations stay server-executed effects (the model never sees a write tool); the MCP wrapper exposes reads only.
- **I3/I5** — the integration declares `auth` + receives `deps.credential`; it imports `@platform/core` types only, never the store/Postgres.
- The `write-integration` skill (sub-stage 4) is the procedure — **run the integration build THROUGH the skill** (this IS the skill's validation; if the skill is unclear at any step, that is a skill bug to fix, per its self-improvement stage).

### Conventions

English; Prettier; never `git add -A`; commit trailer; TDD for the pure functions; **`browser-verify` before browser work**; sweep `yarn typecheck && yarn test && yarn lint && yarn build`. Live Gmail E2E uses the connected token — do REAL actions, then UNDO them (un-trash/un-star/restore UNREAD; delete test drafts).

---

## TASK 1: build the new `gmail` integration via the skill (TDD)

**Files:** Create `packages/integrations/src/gmail/*` (+ tests); modify `packages/integrations/package.json` (exports) + add `@platform/core` dep already present.

- [ ] **Step 1: Invoke the `write-integration` skill** and follow it. Auth interview answer: `kind: oauth2`, provider `google`, scopes `['https://www.googleapis.com/auth/gmail.modify']`, consumed by lead-inbox + email-inbox. The skill will have you scaffold `auth` + the functions taking `deps.credential`.

- [ ] **Step 2: Implement the merged surface** (TDD each, fakes inject the credential + a fake gmail client):
  - `auth.mjs`/`auth.d.ts` → `export const auth = { kind:'oauth2', provider:'google', scopes:['…gmail.modify'] }`.
  - A client builder `makeGmailClient(credential)` — takes a `ResolvedCredential` (oauth2 `accessToken`), returns a googleapis Gmail client authed with that token (an `OAuth2` client with `setCredentials({ access_token })`). NO file/env reads. `googleapis` stays the optional peer.
  - Functions (ported from basic+viewer, but `deps.credential` instead of `deps.getGmail`-from-files): `listUnread`, `getEmail`, `createDraft`, `markRead`, `trash`, `star`. Each: `const gmail = makeGmailClient(deps.credential)` then the existing logic. Reuse the existing pure `format`/parse helpers (copy them over). Return `ReadResult`/`BatchActionResult` per the contract.
  - `checkCredentials(deps)` → "did `resolveCredential` (or the injected credential) yield a usable token?" → `HealthCheck`.
  - The stdio MCP `index.mjs` — read tools only (`list_unread`, `get_email`); it RESOLVES the credential itself: `resolveCredential({ integration:'gmail', connectionId: atizarEnv.connection(), auth })` then calls the function with `deps.credential`. (The MCP child has `ATIZAR_*` from claude-spawn.)
  - Subpath exports in `package.json` (`./gmail`, `./gmail/list-unread`, `./gmail/get-email`, `./gmail/create-draft`, `./gmail/modify`, `./gmail/check-credentials`, `./gmail/auth`).
  - The skill appends the gmail block to `.env.example` (`ATIZAR_GOOGLE_CLIENT_ID/SECRET` already there from sub-stage 2 — confirm; no per-integration API key for oauth2).

- [ ] **Step 3:** unit tests green (`yarn vitest run packages/integrations/src/gmail/`); `yarn typecheck`. Commit (one commit per function or a few — follow the skill's TDD cadence).

```bash
git add packages/integrations/src/gmail/ packages/integrations/package.json .env.example
git commit -m "feat(integrations): gmail integration on the auth contract (deps.credential, declare-not-self-read) (auth sub-stage 5)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK 2: re-point lead-inbox + email-inbox onto `gmail` (server, MCP, Mastra)

**Files:** Modify `apps/inbox/workflows/{lead-inbox,email-inbox}/server.ts`; `apps/inbox/server/claude-spawn.ts`; `apps/inbox/server/mastra/tools.ts`; `apps/inbox/workflows/email-inbox/apply-actions.ts`; `apps/inbox/server/connections.ts` (scopes from the integration's real `auth`).

- [ ] **Step 1: Server effects** — the effect functions now resolve the credential server-side and call the new gmail functions with `deps.credential`. E.g. `saveDraft: async (form, ctx) => { const cred = await resolveCredential({ integration:'gmail', connectionId: ctx.connectionId ?? 'default', auth }); if (!cred) return { error: 'Gmail not connected' }; return createDraft({ threadId, body }, { credential: cred }) }`. Same for `applyEmailActions` (it calls `markRead`/`trash`/`star` with the resolved credential). **Thread `connectionId` into the effect ctx** (the gate/effect ctx — add it if not present; default `'default'`).

- [ ] **Step 2: MCP config** — `claude-spawn.ts`: replace `gmail`/`gmail-viewer` MCP server entries with the single `require.resolve('@platform/integrations/gmail')`; the allow-lists in the workflow `server.ts` change `mcp__gmail__*`/`mcp__gmail-viewer__*` → `mcp__gmail__*` (read tools). Ensure `ATIZAR_CONNECTION` is set per agent (default `'default'`).

- [ ] **Step 3: Mastra tools** — `mastra/tools.ts`: the read tools (`list_unread`/`get_email`/`get_latest_email`) resolve the credential in-process (`resolveCredential(...)`) and call the new gmail functions. (Effects are server-side, not Mastra tools.)

- [ ] **Step 4: connections.ts** — `scopesFor`/`list` now derive from the gmail integration's real `auth.scopes` (replace the sub-stage-3 stub).

- [ ] **Step 5:** `yarn typecheck && yarn test && yarn lint && yarn build` green. Commit.

```bash
git add apps/inbox/workflows/lead-inbox/server.ts apps/inbox/workflows/email-inbox/server.ts apps/inbox/workflows/email-inbox/apply-actions.ts apps/inbox/server/claude-spawn.ts apps/inbox/server/mastra/tools.ts apps/inbox/server/connections.ts
git commit -m "refactor(app): re-point lead-inbox + email-inbox onto the gmail auth-contract integration (auth sub-stage 5)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## TASK 3: delete the old gmail integrations

**Files:** Delete `packages/integrations/src/gmail-basic/` + `gmail-viewer/` + their skill folder(s); remove their `package.json` exports; remove stray `gmail-client.mjs` file-reading.

- [ ] **Step 1:** confirm NO references remain: `grep -rn "gmail-basic\|gmail-viewer" --include=*.ts --include=*.tsx --include=*.mjs --include=*.json apps packages | grep -v node_modules` → empty (except maybe historical docs — leave docs). Move the gmail consumer skill to `packages/integrations/skills/gmail/SKILL.md` (rewrite its credentials section to the Connect-flow model — coordinate with sub-stage 4 if it deferred this).

- [ ] **Step 2:** delete the dirs + exports; `yarn typecheck && yarn test && yarn lint && yarn build` green (this catches any missed reference). Commit.

```bash
git add -u packages/integrations/ apps/inbox/ ; git add packages/integrations/skills/gmail/
git commit -m "refactor(integrations): delete file-reading gmail-basic/gmail-viewer (replaced by gmail) (auth sub-stage 5)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

> (`git add -u` here stages deletions of already-tracked files in those paths only — NOT `-A`. Verify `git status` shows only the intended deletions + the moved skill before committing.)

---

## TASK 4: browser E2E — the end-to-end validation (both providers)

Invoke `browser-verify` first. Needs the real Google Web client env + `ATIZAR_SECRET_KEY` (`set -a; . ./.env.local; set +a`).

- [ ] **Step 1 (claude-cli, dev):** `DEV_RECORD_REPLAY=record yarn dev` (real run — the cred path can't replay a live token cleanly the first time; record fresh). Open `:5173`:
  1. Header chip: **Gmail not connected** → click **Connect** → Google login/consent → back → chip **Gmail ✓**.
  2. Run **email-inbox**: START sorter → it reads via the resolved token (the MCP child resolved the credential) → dispatch → a batch child → edit rows → Apply → **real Gmail action on the connected account** (verify via API; undo). Reply child → draft → Approve → **real draft** (verify by id; delete).
  3. Run **lead-inbox** (qualifier + reply) once → confirms the other workflow still works on the new gmail.
  4. **Disconnect** → chip "not connected" → START sorter → it now reports "Gmail not connected" (the agent is unhealthy / the run errors with a clear not-connected message, not a crash).

- [ ] **Step 2 (Mastra, prod path):** `PROVIDER=mastra yarn dev` → repeat the connect + a reply-approve→real-draft + a batch-approve→real-action (undo) → confirms the in-process resolve path works on the production provider.

- [ ] **Step 3:** record PASS/FAIL per flow. A FAIL is a STOP. The valuable bugs here are credential-threading ones (a path that still reads files, or the MCP child missing `ATIZAR_*`) — fix and re-verify.

---

## TASK 5: wrap-up — foundation check + docs + the skill's self-improvement

- [ ] **check-foundation:** the integration declares `auth` + takes `deps.credential` (no self-read — grep proves it); mutations stay server effects (I2/I9); the MCP wrapper exposes reads only; core untouched (I3/I5). WARN → STOP.
- [ ] **HANDOFF:** "Sub-stage 5 ✅ BUILT — single `gmail` integration on the auth contract (Connect-flow token, no files); lead-inbox + email-inbox re-pointed; old gmail-basic/gmail-viewer deleted. Browser E2E PASS on claude-cli + Mastra (connect → real action → disconnect). The integration-auth feature is COMPLETE — end users connect Gmail via a button, tokens are encrypted, no files." Note the `~/.gmail-mcp/` files are now unused.
- [ ] **`docs/AGENTIC.md`:** the auth contract is proven end-to-end; the `gmail` integration is the worked exemplar the `write-integration` skill points at.
- [ ] **write-integration self-improvement stage:** since this sub-stage RAN the skill to build gmail, do its self-improvement honestly — did any skill stage misfit the oauth2/credential-injection build? If so, amend the skill (quote the incident). If nothing systemic, one sentence.
- [ ] **Final sweep + commit docs + final review** (no file-read of secrets anywhere in `gmail`; both workflows + both providers verified; the old integrations are gone with no dangling refs).

## SELF-REVIEW NOTES

- This is a MIGRATION of two live workflows on two providers — the order (build new → re-point → delete → verify both) keeps a revert cheap (the binding change) until the E2E passes.
- The MCP child resolving the credential ITSELF (via the env `claude-spawn` passes) is the subtle part — Task 4 Step 1 flow 2 is the proof it works.
- Running the build THROUGH the skill is the point (validates sub-stage 4) — Task 5 includes the skill's self-improvement on this real run.
- Both providers (claude-cli + Mastra) MUST be verified — the resolve path differs (MCP child vs in-process).
