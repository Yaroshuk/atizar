import { describe, it, expect } from "vitest";
import {
  isAssistant,
  isToolMessage,
  toolCallsOf,
  type Message,
} from "./messages.js";

// Fixture builders — minimal valid AG-UI messages.
function assistantWithToolCall(name: string, id = "tc1"): Message {
  return {
    role: "assistant",
    id: "a1",
    toolCalls: [{ id, type: "function", function: { name, arguments: "{}" } }],
  };
}
function assistantText(content: string): Message {
  return { role: "assistant", id: "a1", content };
}
function toolResult(toolCallId: string): Message {
  return { role: "tool", id: "t1", content: "ok", toolCallId };
}

describe("guards", () => {
  it("isAssistant narrows assistant messages", () => {
    expect(isAssistant(assistantText("hi"))).toBe(true);
    expect(isAssistant(toolResult("tc1"))).toBe(false);
  });

  it("isToolMessage narrows tool messages", () => {
    expect(isToolMessage(toolResult("tc1"))).toBe(true);
    expect(isToolMessage(assistantText("hi"))).toBe(false);
  });

  it("toolCallsOf returns the tool calls of an assistant message, else []", () => {
    expect(toolCallsOf(assistantWithToolCall("confirmSend"))).toHaveLength(1);
    expect(toolCallsOf(assistantText("hi"))).toEqual([]);
    expect(toolCallsOf(toolResult("tc1"))).toEqual([]);
  });
});
