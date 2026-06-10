# Playwright-MCP profile-lock recovery

The Playwright-MCP browser holds a Chrome **profile lock** across sessions. A prior browser-verify
leaves a `mcp-chrome-<id>` Chrome process (and a `SingletonLock`) under
`~/Library/Caches/ms-playwright-mcp/`. The next session's `browser_navigate` then fails with:

> **"Browser is already in use … use --isolated"**

`browser_close` ALSO fails (it needs the same lock), so you cannot recover through the MCP — you
must clear it from a shell.

## Recovery (from a shell)

```bash
pkill -9 -f "ms-playwright-mcp/mcp-chrome"
rm -f ~/Library/Caches/ms-playwright-mcp/mcp-chrome-*/Singleton*
```

Then re-run `browser_navigate`. (Seen 2026-06-10 during the step-2 spike browser E2E.)

## Note

This is macOS path layout (`~/Library/Caches/...`). On Linux the cache dir differs
(`~/.cache/ms-playwright-mcp/` or `$XDG_CACHE_HOME`); the process-kill + `Singleton*` removal is
the same idea — kill the `mcp-chrome` process, remove the lock file, retry.
