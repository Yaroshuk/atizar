#!/bin/bash
# guard-cassette-share.sh — PreToolUse hook for Bash.
# Backstop for the cassette share-safety hard rule (CLAUDE.md): cassettes under
# apps/inbox/.cassettes/ hold REAL captured email/ticket data and must never be
# committed/shared without running scanCassette first. The CLAUDE.md rule (and the
# future cassette-care skill) owns the flow; this hook just blocks the mechanical
# git action when the flow was skipped. Invariant, not project context (AGENTIC.md A8).
#
# Best-effort by design (A8 "don't chase hermetic coverage"): block the obvious
# vectors — staging/committing cassette paths, force-adding past .gitignore, and
# un-ignoring the cassettes line — the human rule covers the rest.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

MSG="BLOCKED: this command would stage/share cassette files (apps/inbox/.cassettes/), which hold REAL captured email/ticket data. Run scanCassette over the file(s) and get explicit user confirmation first — see the cassette share-safety hard rule in CLAUDE.md."

# 1. git add/stash/commit that names a cassette path (incl. `git add -f .cassettes/...`)
if echo "$COMMAND" | grep -qE 'git[[:space:]]+(add|stash|commit)' \
   && echo "$COMMAND" | grep -qE '\.cassettes'; then
  echo "$MSG" >&2
  exit 2
fi

# 2. Editing .gitignore in a way that touches the cassettes line (un-ignoring them):
#    a write/redirect/sed targeting .gitignore while mentioning cassettes.
if echo "$COMMAND" | grep -qE '\.gitignore' \
   && echo "$COMMAND" | grep -qiE 'cassette' \
   && echo "$COMMAND" | grep -qE '(>>?|sed[[:space:]]+-i|tee|perl[[:space:]]+-i)'; then
  echo "$MSG" >&2
  exit 2
fi

exit 0
