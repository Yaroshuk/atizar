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

// createCopilotEndpoint returns a Hono app with `${basePath}/*` already
// registered (here: ALL /api/copilotkit/*). Mount it at root so its baked-in
// path is preserved; this leaves room to add sibling routes later.
const copilot = createCopilotEndpoint({ runtime, basePath: "/api/copilotkit" });

const app = new Hono();
app.route("/", copilot);

serve({ fetch: app.fetch, port: 4000 });
console.log("server on http://localhost:4000");
