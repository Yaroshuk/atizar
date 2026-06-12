# Contributing to Atizar

Thanks for your interest. Atizar is in **beta, building in the open** — issues, discussions, and PRs are all welcome.

## The agentic-first way in

Atizar ships **skills inside its packages** — versioned knowledge the framework's own coding agent reads. They are the fastest way to contribute correctly:

- Adding an integration? Start from the `write-integration` skill.
- Extending a workflow or the server spine? Read the skills in the relevant package before changing code.

Point your coding agent at them; they encode the conventions this repo enforces.

## Local development

- Yarn-classic (1.22) workspace. Install with `yarn install` (add `--ignore-engines` on older Node).
- `yarn dev` — runs the demo app (server on `:4000`, client on `:5173`).
- `yarn test` — vitest across the workspace.
- `yarn typecheck` · `yarn lint` · `yarn format:check` — keep all green before a PR.
- Dev state runs on **Postgres in Docker** (`docker compose up -d postgres`); the dev server runs on the host.

## Pull requests

- One focused change per PR; keep tests, typecheck, and lint green.
- Follow the existing code style (see `docs/CONVENTIONS.md`).
- Describe what you changed and how you verified it.

## Conduct

Be kind and constructive. Harassment of any kind is not tolerated.
