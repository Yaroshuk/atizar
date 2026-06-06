import { describe, it, expect } from "vitest";
import { inboxAgent, providerRegistry } from "./inbox.agent.js";

describe("inbox.agent wiring", () => {
  it("the passport validates and references the mock provider", () => {
    expect(inboxAgent.id).toBe("inbox");
    expect(inboxAgent.provider).toBe("mock");
    expect(inboxAgent.approvals).toEqual(["confirmSend"]);
  });

  it("the registry resolves the agent's provider", () => {
    const provider = providerRegistry.resolve(inboxAgent.provider);
    expect(typeof provider.run).toBe("function");
  });
});
