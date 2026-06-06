import { describe, it, expect } from "vitest";
import { defineProviders, type Provider } from "./providers.js";

const stub: Provider = {
  // eslint-disable-next-line require-yield
  async *run() {
    return;
  },
};

describe("defineProviders", () => {
  it("resolves a provider by name", () => {
    const registry = defineProviders({ mock: stub });
    expect(registry.resolve("mock")).toBe(stub);
  });

  it("throws on an unknown provider name", () => {
    const registry = defineProviders({ mock: stub });
    expect(() => registry.resolve("nope")).toThrow(/unknown provider/i);
  });
});
