import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: '.',
  // The demo app is part of the monorepo, not an external consumer: resolve
  // @atizar/* to their `./src` via the PRIVATE `atizar-src` export condition for
  // the production build too, exactly as `yarn dev` does — so building the app
  // needs no prior package `dist`. The condition is deliberately NOT named
  // `development` (which Vite auto-activates in dev/serve), so a real consumer's
  // Vite never resolves our unshipped `src` — it falls through to `import`/dist.
  // The published `dist` path is validated separately by scripts/check-packages.sh.
  resolve: { conditions: ['atizar-src', 'module', 'browser'] },
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
