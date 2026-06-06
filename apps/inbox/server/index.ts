import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { mockAgent } from "./mock-agent.js";

const runtime = new CopilotRuntime({
  agents: { default: mockAgent },
  runner: new InMemoryAgentRunner(),
});

// createCopilotEndpoint returns a Hono app with `ALL ${basePath}/*` baked in.
// That wildcard DOES match the bare `/api/copilotkit` (Hono treats basePath +
// "*" as covering the prefix itself), so the mount is fine — the routing lives
// INSIDE the handler. `mode` must match the client's transport:
//   - default "multi-route": REST paths (`/info`, `/agent/:id/run`, …). The bare
//     path has no route → 404.
//   - "single-route": ONE POST endpoint at the bare basePath, dispatched by a
//     JSON envelope `{ method, params, body }`.
// The v2 React client defaults to the single-endpoint transport
// (`useSingleEndpoint ?? true`): its handshake is `POST /api/copilotkit` with
// `{ method: "info" }`. So the server MUST be single-route, or that bare POST 404s.
const copilot = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
  mode: "single-route",
});

const app = new Hono();
app.route("/", copilot);

serve({ fetch: app.fetch, port: 4000 });
console.log("server on http://localhost:4000");
