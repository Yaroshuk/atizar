import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Anchor the project root to this file's directory so include globs
  // (apps/inbox/**, packages/*/**) resolve identically whether vitest is
  // invoked from the repo root (`yarn test`) or an app dir with
  // `-c ../../vitest.config.ts` (`yarn workspace inbox test`).
  root: import.meta.dirname,
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./apps/inbox/client/src/test/setup.ts'],
    include: ['apps/inbox/**/*.test.{ts,tsx,mjs}', 'packages/*/src/**/*.test.{ts,tsx}'],
    css: true,
    server: {
      deps: {
        inline: [/@copilotkit\//],
      },
    },
  },
})
