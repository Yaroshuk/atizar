---
name: gmail-viewer
description: How to use the @platform/integrations gmail-viewer integration — wiring its read tools into an agent, executing its mutations as server effects, setting up Gmail OAuth credentials, and diagnosing checkCredentials failures. Use when importing gmail-viewer, adding Gmail capabilities to a workflow, or when an agent shows "missing credentials" for Gmail.
---

# gmail-viewer — how to use

Read + act on a Gmail inbox: list unread emails, fetch one email's body, mark read,
trash, star. Reads go to the model as tools; mutations are SERVER-EXECUTED effects
behind approval gates — never expose them to a model.

## Surface

| import | function | kind |
|---|---|---|
| `@platform/integrations/gmail-viewer/list-unread` | `listUnread({ sinceHours? })` → `ReadResult<{ emails: EmailRef[] }>` | read |
| `@platform/integrations/gmail-viewer/get-email` | `getEmail({ messageId })` → `ReadResult<ParsedEmail>` incl. `body` | read |
| `@platform/integrations/gmail-viewer/modify` | `markRead\|trash\|star({ messageIds })` → `BatchActionResult` | mutation |
| `@platform/integrations/gmail-viewer/check-credentials` | `checkCredentials()` → `HealthCheck` | health |
| `@platform/integrations/gmail-viewer` | stdio MCP server: `list_unread`, `get_email` (READ ONLY) | model tools |

Result shapes (`HealthCheck` / `ReadResult` / `BatchActionResult`) are the shared `@platform/core` integration contract — import them, they are not gmail-specific.

`EmailRef = { messageId, threadId, from, subject, date, snippet }`. Mutations are
best-effort per message: `failed` lists per-id errors; `{ error }` means the client
itself was unavailable. `trash` moves to Gmail Trash (reversible ~30 days), it never
permanently deletes.

## Wiring rules

- **Model side (claude-cli):** add the MCP server to the spawn's `--mcp-config` and put
  ONLY the read tools on the agent's allow-list (`mcp__gmail-viewer__list_unread`,
  `mcp__gmail-viewer__get_email`); declare them in `defineAgent.readonly`.
- **Model side (Mastra):** register `listUnread`/`getEmail` as native read tools.
- **Mutations:** bind them as `ServerBinding.effects` keyed by the approval tool name —
  the server calls `markRead`/`trash`/`star` AFTER a human approves a gate. Never put a
  mutation on a model allow-list; the framework refuses to boot on an unclassified tool.
- **Health:** call `checkCredentials()` in your server's health surface; show its `hint`
  to the user when not ok.

## Credentials

Credentials follow the framework auth contract. The OAuth **app** registration (client
id/secret) is set ONCE in the repo-root `.env.example` → `.env.local`:

- `ATIZAR_GOOGLE_CLIENT_ID` + `ATIZAR_GOOGLE_CLIENT_SECRET` — the OAuth client (GCP Console →
  APIs & Services → Credentials → OAuth client ID).
- `ATIZAR_SECRET_KEY` — the AES master key for the encrypted credential store.

The **per-user token** is obtained by clicking **Connect** in the app header (the OAuth flow,
sub-stage 3) and is stored ENCRYPTED in the `credentials` table — NOT by hand-placing files.
`resolveCredential` yields the live token to the integration.

`googleapis` is an optional peer — `yarn add googleapis` in the consuming app.

> **Transition note (until sub-stage 5):** the gmail-viewer build CURRENTLY still reads
> `~/.gmail-mcp/gcp-oauth.keys.json` + `~/.gmail-mcp/credentials.json` at call time (paths
> overridable via `GMAIL_OAUTH_KEYS` / `GMAIL_OAUTH_CREDENTIALS`); sub-stage 5 rewrites it to
> consume `resolveCredential` and the Connect flow. So TODAY both paths exist — the files are
> still the live path for gmail. Once the gmail rewrite lands, the files go away and **Connect**
> is the only path.

## Diagnosing checkCredentials failures

| error contains | meaning | fix |
|---|---|---|
| not connected (no stored token / `resolveCredential` → null) | no per-user token in the credential store (the post-sub-stage-5 path) | click **Connect** in the app header; ensure `ATIZAR_GOOGLE_CLIENT_ID/SECRET` + `ATIZAR_SECRET_KEY` are set |
| `ENOENT` … `gcp-oauth.keys.json` | no OAuth client file (transition path, still real today) | create/download the client JSON, or set `ATIZAR_GOOGLE_CLIENT_ID/SECRET` + use Connect |
| `ENOENT` … `credentials.json` | no user token file (transition path, still real today) | click **Connect**, or run your OAuth flow for the account with scope `gmail.modify` |
| `invalid_grant` | token expired/revoked | re-Connect; or re-run the OAuth flow and replace credentials.json |
| `insufficient.*scope` / 403 | token has a narrower scope | re-grant with `gmail.modify` |
| `Optional dependency "googleapis" is not installed` | peer missing | `yarn add googleapis` |
