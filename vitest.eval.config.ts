import { defineConfig } from 'vitest/config'

// Eval harness config — SEPARATE from vitest.config.ts because the eval runs in DEMO mode
// (in-memory PGlite + synthetic-cassette replay), set via env BEFORE any module loads. The
// default config wires the test Postgres + globalSetup, which the eval must not inherit.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    environment: 'node',
    globals: true,
    env: { DEMO: '1' },
    include: ['apps/inbox/eval/**/*.eval.ts'],
    // Eval scenarios share one in-memory PGlite per worker; keep a file's tests in-process
    // and serial (resetDb between them). Cross-file isolation is automatic (one PGlite per worker).
    fileParallelism: false,
    testTimeout: 60_000,
  },
})
