import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

// Library build for the PUBLISHED @atizar/providers artifact (ESM + rolled-up .d.ts). See
// @atizar/core's vite.config for the rationale: the monorepo still consumes `./src` via the
// `development` condition; only the published artifact builds. Every bare import is externalized.
export default defineConfig({
  plugins: [dts({ include: ['src'], rollupTypes: true })],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        ids: resolve(__dirname, 'src/provider-ids.ts'),
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
