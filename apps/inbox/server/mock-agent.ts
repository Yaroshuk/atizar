import { EventType, type BaseEvent } from "@ag-ui/client";
import { BuiltInAgent } from "@copilotkit/runtime/v2";

const LEAD = { id: 42, from: "ivan@acme.ru", subject: "Заказ 10 шт", intent: "order" };

// Did a previous turn already resolve the confirmSend approval?
//
// On resume, `input.messages` (parsed RunAgentInput, @ag-ui/core schemas)
// contains:
//   - the prior assistant message with the confirmSend tool call. AG-UI's
//     AssistantMessageSchema keeps the tool name at `toolCalls[].function.name`
//     and the id at `toolCalls[].id`.
//   - a `role:"tool"` message recording the human's answer. AG-UI's
//     ToolMessageSchema STRIPS `name`/`toolName` — it only carries
//     `{ id, content, role:"tool", toolCallId }`.
//
// So we cannot match on a tool message's name. Instead we correlate by id:
// collect the ids of all assistant `confirmSend` tool calls, then check whether
// any `role:"tool"` message answers one of them (`toolCallId` match). This is
// robust against the name being stripped and against the toolCallId being a
// random uuid generated per run.
function approvalResolved(input: any): boolean {
  const msgs = input?.messages ?? [];

  const confirmSendCallIds = new Set<string>();
  for (const m of msgs) {
    if (m?.role === "assistant" && Array.isArray(m.toolCalls)) {
      for (const tc of m.toolCalls) {
        if (tc?.function?.name === "confirmSend" && tc?.id) {
          confirmSendCallIds.add(tc.id);
        }
      }
    }
  }

  return msgs.some(
    (m: any) =>
      m?.role === "tool" &&
      typeof m?.toolCallId === "string" &&
      confirmSendCallIds.has(m.toolCallId),
  );
}

async function* toolCall(name: string, args: unknown): AsyncGenerator<BaseEvent> {
  const toolCallId = crypto.randomUUID();
  yield {
    type: EventType.TOOL_CALL_START,
    parentMessageId: crypto.randomUUID(),
    toolCallId,
    toolCallName: name,
  } as BaseEvent;
  yield {
    type: EventType.TOOL_CALL_ARGS,
    toolCallId,
    delta: JSON.stringify(args),
  } as BaseEvent;
  yield { type: EventType.TOOL_CALL_END, toolCallId } as BaseEvent;
}

export const mockAgent = new BuiltInAgent({
  type: "custom",
  factory: async function* ({ input }) {
    if (approvalResolved(input)) {
      yield {
        type: EventType.TEXT_MESSAGE_CHUNK,
        role: "assistant",
        messageId: crypto.randomUUID(),
        delta: "Готово, ответ отправлен.",
      } as BaseEvent;
      return;
    }

    yield {
      type: EventType.TEXT_MESSAGE_CHUNK,
      role: "assistant",
      messageId: crypto.randomUUID(),
      delta: "Проверяю входящие… нашёл заявку.",
    } as BaseEvent;

    yield* toolCall("renderLead", LEAD);
    yield* toolCall("confirmSend", { leadId: LEAD.id, message: "Отправить ответ на заявку?" });
  },
});
