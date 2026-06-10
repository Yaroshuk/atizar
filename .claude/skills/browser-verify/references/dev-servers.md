# Dev servers — kill stale stacks, free ports, diagnose self-reload

Stale dev stacks are this repo's #1 environment footgun. Several live Vite instances contend for
`:5173` (no `strictPort`, so extras grab `:5174+`) and starve the loaded tab's HMR WebSocket; on a
CPU spike (the ~30s `claude` subprocess + 3 stdio MCP servers per run) the WS drops and Vite fires
`vite:ws:disconnect → waitForSuccessfulPing → location.reload()` — a full page reload that resets
ALL React state, and is **NOT** logged as `[vite] page reload` (grepping for that marker finds
nothing). This presents as "the app reloaded itself ~30s into a run" and is an environment
artifact, not an app bug.

## The binaries are in the ROOT node_modules/.bin

yarn-classic hoists `tsx`/`vite`/`concurrently` to the **workspace root**, not `apps/inbox/`. So:

```bash
# 1. See what's alive (multiple sessions stack up — seen 5 at once):
ps aux | grep -E "AiWorkflow/node_modules/.bin/(tsx|vite|concurrently)"

# 2. Kill the stacks (the old apps/inbox/node_modules/.bin pattern matches NOTHING):
pkill -9 -f "AiWorkflow/node_modules/.bin/(tsx|vite|concurrently)"
```

## The gotcha within the gotcha: the tsx-watch child holds :4000

`tsx watch server/index.ts` spawns a CHILD `node` running the server whose command line is **NOT**
`…/node_modules/.bin/tsx`, so the `pkill` above MISSES it. The child keeps `:4000`, and the next
`yarn dev` logs `EADDRINUSE` while the stale REPLAY/non-replay server silently keeps answering
`/info` 200 — so you think you restarted but didn't. Always also free the ports directly:

```bash
lsof -tiTCP:4000,:5173,:5174 | xargs kill -9
# confirm free:
lsof -tiTCP:4000 ; lsof -tiTCP:5173    # both should print nothing
```

## predev mitigates, but doesn't replace Stage 1

A `predev` script (`apps/inbox/package.json`) frees `:4000`/`:5173` LISTEN sockets before every
`yarn dev`, so a fresh server binds in the intended `DEV_RECORD_REPLAY` mode. This was the root
cause of a "cassettes don't work" report (a stale non-replay server on `:4000` intercepted every
request). `predev` also runs `docker compose up -d --wait postgres`. Still run the `ps`/`pkill`/
`lsof` ladder for stragglers `predev` can't see (e.g. a non-LISTEN child mid-teardown).
(macOS/Linux only — `predev` uses `lsof`.)

## Confirm a clean single boot

After `yarn dev` from the repo root:

- exactly ONE `server on http://localhost:4000` line,
- exactly ONE vite on `:5173` (no `EADDRINUSE`, no `:5174` fallback),
- `grep -c EADDRINUSE <dev-output>` → `0`.

If any of these is off, a stale process survived — repeat the kill ladder before driving the
browser. A record-mode restart that still replays means a stale server is answering `:4000`.

## Never containerize the dev server

The app stays `yarn dev` on the host: `claude-cli` needs the local binary + macOS-keychain auth.
Only Postgres runs in Docker (`docker compose up -d postgres`).
