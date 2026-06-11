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

OAuth client + token files, read at call time:

- `~/.gmail-mcp/gcp-oauth.keys.json` — the OAuth client (GCP Console → APIs & Services →
  Credentials → OAuth client ID, type Desktop; download the JSON). Override path with
  `GMAIL_OAUTH_KEYS`.
- `~/.gmail-mcp/credentials.json` — the user token (an OAuth2 grant for the account, scope
  `https://www.googleapis.com/auth/gmail.modify` — covers read, labels, trash, drafts).
  Override path with `GMAIL_OAUTH_CREDENTIALS`.
- `googleapis` is an optional peer — `yarn add googleapis` in the consuming app.

## Diagnosing checkCredentials failures

| error contains | meaning | fix |
|---|---|---|
| `ENOENT` … `gcp-oauth.keys.json` | no OAuth client file | create/download the client JSON (above) |
| `ENOENT` … `credentials.json` | no user token | run your OAuth flow for the account with scope `gmail.modify` |
| `invalid_grant` | token expired/revoked | re-run the OAuth flow; replace credentials.json |
| `insufficient.*scope` / 403 | token has a narrower scope | re-grant with `gmail.modify` |
| `Optional dependency "googleapis" is not installed` | peer missing | `yarn add googleapis` |
