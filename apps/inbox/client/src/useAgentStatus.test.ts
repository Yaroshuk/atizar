import { describe, it, expect } from "vitest";
import { hasPendingApproval, type AgentMessage } from "./useAgentStatus";

// `hasPendingApproval` is the render-INDEPENDENT predicate that decides whether
// the AgentCard should show "Awaiting approval" (awaiting_approval). It reads
// `agent.messages` directly — the same shape the agent accumulates and the mock
// streams in (tool name at `toolCalls[].function.name`, id at `toolCalls[].id`;
// tool results as `{ role:"tool", toolCallId }`).
//
// This is the core of the bug fix: the closed card must reflect the pause
// without the ApprovalDialog (or modal) ever rendering, so this logic lives in
// pure message state, not in a render callback.

const assistantText = (content: string): AgentMessage => ({
  role: "assistant",
  // @ts-expect-error content not on the minimal AgentMessage shape; harmless
  content,
});

const confirmSendCall = (id: string): AgentMessage => ({
  role: "assistant",
  toolCalls: [{ id, function: { name: "confirmSend" } }],
});

const renderLeadCall = (id: string): AgentMessage => ({
  role: "assistant",
  toolCalls: [{ id, function: { name: "renderLead" } }],
});

const toolResult = (toolCallId: string): AgentMessage => ({
  role: "tool",
  toolCallId,
});

describe("hasPendingApproval", () => {
  it("is TRUE when a confirmSend tool call has no matching tool message (run paused for human)", () => {
    const messages: AgentMessage[] = [
      assistantText("Checking inbox… found a lead."),
      renderLeadCall("tc_lead"),
      confirmSendCall("tc_confirm"),
    ];
    expect(hasPendingApproval(messages)).toBe(true);
  });

  it("is FALSE when the confirmSend tool call has a matching role:'tool' message (human approved)", () => {
    const messages: AgentMessage[] = [
      assistantText("Checking inbox… found a lead."),
      renderLeadCall("tc_lead"),
      confirmSendCall("tc_confirm"),
      toolResult("tc_confirm"),
      assistantText("Done — reply sent."),
    ];
    expect(hasPendingApproval(messages)).toBe(false);
  });

  it("is FALSE when there is only a renderLead tool call (no confirmSend at all)", () => {
    const messages: AgentMessage[] = [
      assistantText("Checking inbox… found a lead."),
      renderLeadCall("tc_lead"),
    ];
    expect(hasPendingApproval(messages)).toBe(false);
  });

  it("is FALSE for an empty message list (idle / before first run)", () => {
    expect(hasPendingApproval([])).toBe(false);
  });

  it("matches the approval by toolCallId, not by the tool message's name (AG-UI strips it)", () => {
    // A tool result answering a DIFFERENT call must not count as resolving the
    // pending confirmSend.
    const messages: AgentMessage[] = [
      confirmSendCall("tc_confirm"),
      toolResult("tc_other"),
    ];
    expect(hasPendingApproval(messages)).toBe(true);
  });
});
