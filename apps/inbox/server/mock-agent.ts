import { EventType, type BaseEvent } from "@ag-ui/client";
import { BuiltInAgent } from "@copilotkit/runtime/v2";

// Spike: a custom-factory agent that yields ONE AG-UI text message chunk.
// `type: "custom"` => the factory yields raw AG-UI events directly
// (BuiltInAgentCustomFactoryConfig). The runtime handles run lifecycle.
export const mockAgent = new BuiltInAgent({
  type: "custom",
  factory: async function* (): AsyncGenerator<BaseEvent> {
    const messageId = crypto.randomUUID();
    yield {
      type: EventType.TEXT_MESSAGE_CHUNK,
      role: "assistant",
      messageId,
      delta: "Проверяю входящие…",
    } as BaseEvent;
  },
});
