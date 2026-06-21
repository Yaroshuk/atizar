#!/usr/bin/env bash
# check-packages.sh — prove the @atizar/* packages are installable by an OUTSIDE consumer.
#
# It pretends to be a stranger who installs the framework: it builds + packs the five packages
# into tarballs, creates a THROWAWAY project in a temp dir (no monorepo paths), installs the
# tarballs there, then typechecks + builds the client + boots the server in demo mode and runs
# the full approve->done pipeline. Prints PASS or FAIL. Run it whenever you change packaging.
#
#   bash scripts/check-packages.sh
#
# Needs Node >= 20.19 (vite 8 / rolldown); it auto-picks one from nvm if your default is older.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
TARBALLS="$WORK/tarballs"
CONSUMER="$WORK/consumer"
mkdir -p "$TARBALLS" "$CONSUMER/src"

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# --- pick a new-enough Node (vite 8 needs >= 20.19) -------------------------------------------
node_major_minor() { node -e 'const [a,b]=process.versions.node.split(".");console.log(+a*100+ +b)'; }
if [ "$(node_major_minor)" -lt 2019 ]; then
  for v in v22.22.0 v22.21.1 v22.3.0 v20.20.1 v20.19.5; do
    if [ -x "$HOME/.nvm/versions/node/$v/bin/node" ]; then
      export PATH="$HOME/.nvm/versions/node/$v/bin:$PATH"; break
    fi
  done
fi
echo "▶ using node $(node -v)"

# --- 1. build + pack the five packages --------------------------------------------------------
echo "▶ building packages (yarn build:lib)..."
( cd "$REPO" && yarn build:lib >/dev/null 2>&1 )
echo "▶ packing tarballs..."
for p in core providers server react integrations; do
  ( cd "$REPO/packages/$p" && npm pack --pack-destination "$TARBALLS" >/dev/null 2>&1 )
done

# --- 2. scaffold a fresh consumer project -----------------------------------------------------
echo "▶ scaffolding a throwaway consumer in $CONSUMER..."
cat > "$CONSUMER/package.json" <<'JSON'
{ "name": "atizar-consumer-check", "private": true, "type": "module",
  "scripts": { "typecheck": "tsc --noEmit", "build:client": "vite build", "start": "tsx src/server.ts" } }
JSON

cat > "$CONSUMER/tsconfig.json" <<'JSON'
{ "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
  "lib": ["ES2022","DOM","DOM.Iterable"], "jsx": "react-jsx", "strict": true, "skipLibCheck": true,
  "noEmit": true, "types": ["node"], "esModuleInterop": true }, "include": ["src"] }
JSON

cat > "$CONSUMER/vite.config.ts" <<'TS'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ plugins: [react()], build: { outDir: 'dist-client' } })
TS

cat > "$CONSUMER/index.html" <<'HTML'
<!doctype html><html><head><meta charset="UTF-8"><title>check</title></head>
<body><div id="root"></div><script type="module" src="/src/client.tsx"></script></body></html>
HTML

cat > "$CONSUMER/src/css.d.ts" <<'TS'
declare module '*.css'
TS

cat > "$CONSUMER/src/workflow.ts" <<'TS'
import { defineAgent, defineWorkflow, definePrompt, type WorkflowDescriptor } from '@atizar/core'
import { PROVIDERS } from '@atizar/providers/ids'
export const greeterAgent = defineAgent({
  id: 'greeter', name: 'GREETER', provider: PROVIDERS.mock,
  instructions: 'Read the lead, draft a reply, ask the human before saving.',
  tools: ['renderLead', 'saveDraft'], approvals: ['saveDraft'], effects: ['saveDraft'],
  renders: { renderLead: 'LeadCard', saveDraft: 'ApprovalDialog' }, maxInstances: 1,
})
export const greeterPrompt = definePrompt<Record<string, never>>({
  onStart: () => 'Greet the lead and propose a draft reply.',
  onResume: (r) => ({ kind: 'message', text: `Draft saved (${JSON.stringify(r)}).` }),
})
export const smokeWorkflow: WorkflowDescriptor = defineWorkflow({
  id: 'smoke', label: 'Smoke demo', iconName: 'inbox',
  prompt: 'Tiny demo. Propose; never act without approval.',
  agents: [{ agent: greeterAgent, role: 'input' }], entryAgentId: greeterAgent.id,
  inputs: [], connections: [],
})
TS

cat > "$CONSUMER/src/server.ts" <<'TS'
import { defineProviders, type ProviderRegistry } from '@atizar/core'
import { createMockInboxProvider, PROVIDERS } from '@atizar/providers'
import { createServer, buildAgentProvider, type WorkflowServerLike, type BuildProviderFn } from '@atizar/server'
import { smokeWorkflow, greeterAgent, greeterPrompt } from './workflow.js'
const providerRegistry: ProviderRegistry = defineProviders({
  [PROVIDERS.mock]: (c) => createMockInboxProvider(c.approvalNames),
})
const buildProvider: BuildProviderFn = (def, prompts, registry, allowedTools, instanceKey, composed) =>
  buildAgentProvider({ def, prompts, registry, allowedTools, instanceKey, composedInstructions: composed })
const workflowServers: WorkflowServerLike[] = [{
  descriptor: smokeWorkflow,
  bindings: () => [{ agentId: greeterAgent.id, prompts: greeterPrompt,
    allowedTools: ['renderLead', 'saveDraft'],
    effects: { saveDraft: async () => ({ ok: true, draftId: 'demo-1' }) } }],
}]
await createServer({ workflowServers, providerRegistry, buildProvider, connections: [],
  scopesFor: () => [], enabledWorkflows: null, instanceKeyOf: (a) => a, sourceOf: () => null, start: true })
TS

cat > "$CONSUMER/src/client.tsx" <<'TS'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkflowsProvider, Button, CardShell, useBoard, type WorkflowsConfig } from '@atizar/react'
import '@atizar/react/styles.css'
import { smokeWorkflow } from './workflow.js'
const config: WorkflowsConfig = { workflows: [smokeWorkflow], meta: {}, renders: [], hitl: [] }
const Board = () => {
  const board = useBoard()
  return (<CardShell><h1>Atizar consumer check</h1><Button onClick={() => undefined}>Start</Button>
    <pre>{JSON.stringify(board ?? {}, null, 2)}</pre></CardShell>)
}
createRoot(document.getElementById('root')!).render(
  <StrictMode><WorkflowsProvider config={config}><Board /></WorkflowsProvider></StrictMode>)
TS

# --- 3. install the tarballs + peers ----------------------------------------------------------
echo "▶ installing the packed @atizar/* into the consumer..."
( cd "$CONSUMER" && npm install --no-audit --no-fund \
    "$TARBALLS"/atizar-core-*.tgz "$TARBALLS"/atizar-providers-*.tgz \
    "$TARBALLS"/atizar-server-*.tgz "$TARBALLS"/atizar-react-*.tgz \
    "$TARBALLS"/atizar-integrations-*.tgz \
    react@^19 react-dom@^19 zod@^3.25.76 @ag-ui/client@^0.0.55 \
    -D vite@^8.0.16 @vitejs/plugin-react@^6 typescript@^6 tsx@^4 @types/react@^19 @types/react-dom@^19 @types/node@^22 \
    >/dev/null 2>&1 )

# --- 4. typecheck + build client --------------------------------------------------------------
echo "▶ typecheck..."; ( cd "$CONSUMER" && npx tsc --noEmit )
echo "▶ vite build (client)..."; ( cd "$CONSUMER" && npx vite build >/dev/null 2>&1 )

# --- 5. boot the server (demo / in-memory db) + run the full pipeline --------------------------
echo "▶ booting the server in demo mode + running the approve→done pipeline..."
( cd "$CONSUMER" && DEMO=1 PORT=4490 npx tsx src/server.ts > "$WORK/server.log" 2>&1 ) &
SRV=$!
disown "$SRV" 2>/dev/null || true  # silence bash's "Terminated" job notice when we kill it below
for i in $(seq 1 30); do grep -q "server on" "$WORK/server.log" 2>/dev/null && break; sleep 1; done

ok=1
if ! grep -q "server on" "$WORK/server.log"; then ok=0; echo "  ✗ server did not boot"; cat "$WORK/server.log"; fi
ID=$(curl -s -X POST http://localhost:4490/api/dispatch -H 'content-type: application/json' \
      -d '{"agent":"smoke__greeter","payload":{}}' | node -e 'process.stdin.on("data",d=>{try{console.log(JSON.parse(d).id)}catch{}})')
sleep 3
GATE=$(curl -s "http://localhost:4490/api/workitems/$ID/gate" | node -e 'process.stdin.on("data",d=>{try{console.log(JSON.parse(d).id)}catch{}})')
curl -s -X POST "http://localhost:4490/api/gates/$GATE/resolve" -H 'content-type: application/json' \
  -d '{"formRev":0,"decision":"approved"}' >/dev/null
sleep 2
RESULT=$(curl -s "http://localhost:4490/api/workitems/$ID/audit" | node -e 'process.stdin.on("data",d=>{try{console.log(JSON.parse(d).map(e=>e.summary).join(" → "))}catch{}})')
kill "$SRV" 2>/dev/null || true

echo "  pipeline audit: ${RESULT:-<none>}"
echo "$RESULT" | grep -q "executed saveDraft" && echo "$RESULT" | grep -q "done" || ok=0

echo
if [ "$ok" = 1 ]; then
  echo "✅ PASS — the @atizar/* packages install + build + run from a clean outside project."
else
  echo "❌ FAIL — see the output above."; exit 1
fi
