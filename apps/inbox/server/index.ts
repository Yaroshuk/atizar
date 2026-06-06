import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { inboxAgent, providerRegistry } from "../core/inbox.agent.js";
import { buildAgent } from "./build-agent.js";

const runtime = new CopilotRuntime({
  agents: { default: buildAgent(inboxAgent, providerRegistry) },
  runner: new InMemoryAgentRunner(),
});

// single-route: ONE POST endpoint at the bare basePath, matching the v2 client's
// default single-endpoint transport (see CLAUDE.md → CopilotKit v2 API notes).
const copilot = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
  mode: "single-route",
});

const app = new Hono();
app.route("/", copilot);

serve({ fetch: app.fetch, port: 4000 });
console.log("server on http://localhost:4000");
