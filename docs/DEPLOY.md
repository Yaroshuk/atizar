# Deploying the demo

The zero-credential demo (`DEMO=1`) runs as **one Node process** — no Postgres, no API keys, no
Docker. It uses an in-memory PGlite database and the committed synthetic cassettes in
`apps/inbox/demo-cassettes/`, and serves the built client itself. That makes it cheap to host on
any Node platform (Render, Railway, Fly, a VM) behind a domain.

## How it fits together

- `yarn build` compiles the client to `apps/inbox/dist`.
- The server (`apps/inbox/server/index.ts`) detects that `dist` and serves it for every non-`/api`
  request, with an SPA fallback to `index.html` (so `/demo` deep-links work). This is the
  `staticDir` seam in `@atizar/server`'s `createServer`.
- The listen port comes from `process.env.PORT` (default `4000`) — hosts inject their own.
- `DEMO=1` selects the in-memory DB + strict cassette replay + the `email-inbox` workflow only.

One process serves the landing (`/`), the demo board (`/demo`), and the API (`/api/*`) from a
single origin — no CORS, no second service.

## Run it locally as one process

```bash
yarn install --ignore-engines
yarn build:web           # builds @atizar/react, then the client → apps/inbox/dist
yarn start:demo          # → http://localhost:4000   (set PORT=… to change)
```

Open `http://localhost:4000` → landing → **Open demo** → the live pipeline.

## Deploy to Render

1. **New → Web Service**, connect this repo.
2. Settings:
   - **Runtime:** Node
   - **Build command:** `yarn install --ignore-engines && yarn build:web`
   - **Start command:** `DEMO=1 yarn workspace inbox start`
   - **Instance type:** Free is fine for a demo (note: free instances sleep when idle, so the first
     request after a pause is slow — it cold-boots and runs migrations).
3. Render injects `PORT`; the server reads it. No other env vars are required for the demo.
4. Deploy. You get a `*.onrender.com` URL — verify the landing and the demo there first.

> The demo needs dev dependencies (`tsx` runs the TypeScript server, `vite` builds the client), so
> install with the default `yarn install` — do **not** set `NODE_ENV=production` for the build, or
> the build step loses `vite`/`tsx`. PGlite (`@electric-sql/pglite`) is an optional dependency of
> `@atizar/server` and installs by default.

(Railway / Fly are equivalent: same build + start commands. Fly wants a Dockerfile or
`fly launch`'s auto-detected Node buildpack; nothing else changes.)

## Point the domain (Namecheap → `demo.atizar.io`)

A subdomain is the simplest path (apex domains can't use a plain CNAME):

1. In Render: **Settings → Custom Domains → Add** `demo.atizar.io`. Render shows a target
   hostname (e.g. `your-service.onrender.com`).
2. In Namecheap: **Domain List → atizar.io → Manage → Advanced DNS → Add New Record**
   - **Type:** CNAME
   - **Host:** `demo`
   - **Value:** the Render target hostname
   - **TTL:** Automatic
3. Wait for DNS to propagate (minutes to ~an hour). Render issues the TLS certificate
   automatically once the record resolves.

The apex `atizar.io` is left free for a future full landing site. If you later want the demo on the
apex too, either use Namecheap's ALIAS record or move DNS to Cloudflare (CNAME flattening).
