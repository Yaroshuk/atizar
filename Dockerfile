# Image for the atizar demo. Runs as ONE process via tsx; DEMO=1 selects the zero-credential mode
# (in-memory PGlite + committed cassettes — no Postgres, no API keys, no external calls). The build
# runs on Fly's builder (ample RAM); the runtime machine only runs the image (~400-550MB → 1GB VM).
FROM node:22-slim

WORKDIR /app

# yarn-classic is the repo's package manager; node:slim doesn't bundle it.
RUN npm install -g yarn@1.22.22 --force

# Install workspace deps + build (@atizar/react lib → client). build:web runs `tsc --build` first
# so the composite declarations exist before the react dts build.
COPY . .
RUN yarn install --ignore-engines
RUN yarn build:web

# The server reads PORT (default 4000) and serves the built client + /api on one port.
EXPOSE 8080
CMD ["yarn", "workspace", "inbox", "start"]
