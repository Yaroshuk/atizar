import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

// Library build for the PUBLISHED @atizar/server artifact (ESM + rolled-up .d.ts). See
// @atizar/core's vite.config for the rationale: the monorepo still consumes `./src` via the
// `development` condition; only the published artifact builds. Every bare import (node builtins,
// hono, drizzle, postgres, the optional pglite peer) is externalized — we ship only our own code.
export default defineConfig({
  plugins: [dts({ include: ['src'], rollupTypes: true })],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        'db/schema': resolve(__dirname, 'src/db/schema.ts'),
        mastra: resolve(__dirname, 'src/mastraTools.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: (id) => id.startsWith('@atizar/') || !/^[./]/.test(id),
    },
    sourcemap: true,
    emptyOutDir: true,
  },
})
