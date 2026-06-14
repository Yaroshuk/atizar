import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: '.',
  // CSS Modules convention for the whole dev build, incl. @atizar/react's
  // co-located *.module.scss (compiled here in dev). camelCaseOnly maps
  // `.card-top` → `s.cardTop`. MUST match the package's own Phase-4 vite.config.ts
  // (the library build) or dev/published class lookups diverge.
  css: { modules: { localsConvention: 'camelCaseOnly' } },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000' },
  },
})
