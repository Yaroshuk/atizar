#!/usr/bin/env sh
# Best-effort: bring up the dev Postgres container before `yarn dev`.
# ONLY the DB is containerized — the app runs on the host (claude-cli needs the
# local binary + macOS-keychain auth). `docker compose up -d` is idempotent, so a
# already-running healthy service is a fast no-op. Non-fatal: core-only work that
# needs no DB still starts even if Docker is down.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v docker >/dev/null 2>&1; then
  echo "[predev] WARN: docker not found — skipping Postgres (install Docker for the DB)"
  exit 0
fi

# --wait blocks until the healthcheck passes, so a migrate step connects to a ready DB.
if docker compose -f "$ROOT/docker-compose.yml" up -d --wait postgres >/dev/null 2>&1; then
  echo "[predev] postgres container up + healthy (:${POSTGRES_PORT:-5432})"
else
  echo "[predev] WARN: could not start postgres container — is Docker Desktop running?"
fi

exit 0
