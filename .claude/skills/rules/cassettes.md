# Cassettes — record/replay care

Topical reference (genre-1 rule) for `DEV_RECORD_REPLAY` cassettes. Full mechanics:
`docs/dev-record-replay.md`. The procedural ops around them (kill stale dev servers, the
record-vs-replay choice during a run) live in the `browser-verify` skill — this rule is the
recall-facts + the share-safety procedure.

## What they are

- One JSONL file per `wf__agent` under `apps/inbox/.cassettes/` (gitignored, **real captured
  data**).
- Keyed by **step** = resolved-approval count (→ the store's resolved-gate count at beta step 5).
- Modes: `=1` / `=replay` (replay if recorded, else record), `=record` (force overwrite), unset
  (no wrapper, pure production path).

## Recall — what bites

- **Replay masks a prompt change.** Changed an agent's prompt? The old cassette replays the stale
  output and you won't see your change. Force `=record` (or delete the file).
- **True replay = cassette mtime unchanged + completes in ~seconds.** If mtime moved or it took
  ~30s, it hit real `claude` — don't call that a replay.
- **"Cassettes don't work"** is almost always a stale server on `:4000` intercepting requests — see
  `browser-verify` (`references/dev-servers.md`).
- **Concurrent HITL:** two instances replaying ONE cassette share its recorded `toolCallId` → a
  false "second approve button is dead." Verify concurrent HITL with `=record` (real `claude` mints
  a unique id).
- **Re-key event (beta step 5):** the step key changes from `resolvedApprovalCount` to the store's
  resolved-gate count → wipe `.cassettes/` once.

## Share-safety (HARD RULE — real captured data)

A cassette holds REAL captured email/ticket data. Before committing / pushing / sharing /
un-gitignoring one:

1. **Warn explicitly** that the file contains real captured data.
2. Run **`scanCassette`** (exported from `apps/inbox/server/record-replay.ts`) over the file(s);
   report every finding with `file:line` + the offending snippet.
3. **Wait** for the user to confirm or scrub before proceeding. If the scan finds nothing, say so
   plainly. Names and postal addresses are not regex-detectable — the human is the final reviewer.

Mechanical backstop: the `guard-cassette-share` hook blocks `git add|stash|commit` naming a
`.cassettes` path (incl. `add -f`) and `.gitignore` edits touching the cassettes line. **Never
share a cassette silently.**

## Synthetic cassettes (demo, ~beta step 7)

For `DEMO=1`, author synthetic cassettes from scratch with invented names/emails. NEVER scrub a
real recording into a demo fixture.
