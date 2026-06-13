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
    // fileParallelism:false → all eval files run sequentially in ONE worker, sharing the same
    // in-memory PGlite (the module-load singleton). Isolation comes from resetDb() in each file's
    // beforeEach — NOT from worker separation; do not drop those resets.
    fileParallelism: false,
    testTimeout: 60_000,
  },
})
