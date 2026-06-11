#!/bin/bash
# guard-foundation-edits.sh — PreToolUse hook (Edit | Write | Bash).
# Backstop for the protected-foundation rule (CLAUDE.md, AGENTIC.md A8): docs/PHILOSOPHY.md and
# docs/ARCHITECTURE.md define what the framework IS — the three beliefs + the invariants I1–I15.
# Editing them is dangerous and delicate and must not happen silently, so this hook forces an
# explicit user confirmation ("ask") before the edit runs. It does NOT hard-block: the developer
# confirms and proceeds. The CLAUDE.md rule + the check-foundation skill own the flow; this is the
# mechanical backstop only.
#
# Protected set = the FINAL foundation docs. NOT the temporary build spec pipeline-updated-3.md
# (it changes as the beta is built). When the clean docs/pipeline.md is written (~beta step 7),
# add it to the pattern below.
#
# Mechanism (verified against the current Claude Code hooks docs): print the JSON below on stdout
# and exit 0. permissionDecision "ask" prompts the user; approve → the tool runs, reject → blocked.
# exit 0 is REQUIRED (a non-zero exit makes the hook error and the tool proceeds with no prompt).

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')

case "$TOOL" in
  Edit | Write) TARGET=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty') ;;
  Bash) TARGET=$(echo "$INPUT" | jq -r '.tool_input.command // empty') ;;
  *) exit 0 ;;
esac

[ -z "$TARGET" ] && exit 0

# Not a foundation doc → defer to the normal flow.
if ! echo "$TARGET" | grep -qE 'docs/(PHILOSOPHY|ARCHITECTURE)\.md'; then
  exit 0
fi

# For Bash, READING a foundation doc is ALWAYS allowed (cat/sed -n/grep/head/less/…) — only a
# WRITE prompts. We match the few unambiguous write vectors that don't collide with read
# commands: a redirect into the file (`>`/`>>`) and the in-place editors (sed -i / perl -i / tee).
# This is deliberately a SMALL, precise set: broadening it to cp/mv/dd reintroduced false
# prompts on reads (e.g. `grep -n cp <doc>`), and a read must never be blocked. The Edit/Write
# tools are the real edit path and are caught above regardless. Anything else here → read → defer.
if [ "$TOOL" = "Bash" ]; then
  if ! echo "$TARGET" | grep -qE '(>>?|sed[[:space:]]+-i|perl[[:space:]]+-i|tee)'; then
    exit 0
  fi
fi

REASON="PROTECTED FOUNDATION DOC ($TARGET). This defines what the framework IS — the three beliefs (PHILOSOPHY.md) and the locked invariants I1-I15 (ARCHITECTURE.md section 0). Changing it is dangerous and delicate. Confirm you intend this change and have run check-foundation; otherwise reject."

jq -n --arg r "$REASON" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: $r}}'
exit 0
