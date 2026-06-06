import { EventType, type BaseEvent } from "@ag-ui/client";
import { BuiltInAgent } from "@copilotkit/runtime/v2";

const LEAD = { id: 42, from: "ivan@acme.ru", subject: "Заказ 10 шт", intent: "order" };

// Did a previous turn already resolve the confirmSend approval?
// NOTE: best-effort heuristic for the resumed-turn message shape; to be
// verified/tightened in Task 4 (approval wiring). A real AG-UI ToolMessage
// matches by `toolCallId` (no `name`/`toolName` field), so this also tolerates
// a custom-shaped resume message carrying the tool name.
function approvalResolved(input: any): boolean {
  const msgs = input?.messages ?? [];
  return msgs.some(
    (m: any) =>
      m?.role === "tool" &&
      (m?.name === "confirmSend" || m?.toolName === "confirmSend")
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
