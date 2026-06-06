import { useRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { LeadCard } from "./components/LeadCard";
import { ApprovalDialog } from "./components/ApprovalDialog";

// Generative-UI registration for the inbox agent.
//
// In CopilotKit v2 (1.59) agent-emitted tool calls are mapped to React
// components with the `useRenderTool` hook (from `@copilotkit/react-core/v2`).
// Each call registers a name-scoped renderer: when the agent emits a tool call
// with that `name`, CopilotKit invokes the `render` function with the streamed
// `parameters` (typed by the Zod schema) and a `status`
// ("inProgress" | "executing" | "complete").
//
// The registered renderer is applied wherever the tool call is surfaced — here
// we apply it manually in App.tsx via `useRenderToolCall()`, which returns a
// function that renders a given tool call using these registrations.
//
// Call `useInboxActions()` inside a component nested under <CopilotKit>.
export function useInboxActions() {
  // renderLead -> <LeadCard lead={...} />  (fully wired this task)
  useRenderTool(
    {
      name: "renderLead",
      parameters: z.object({
        id: z.number(),
        from: z.string(),
        subject: z.string(),
        intent: z.string(),
      }),
      render: ({ parameters }) => {
        // Render whenever the four required fields are present. We do NOT gate
        // on `status !== "inProgress"`: when surfacing historical tool calls
        // from `agent.messages` via `useRenderToolCall({ toolCall })` (no
        // `toolMessage`, id not in `executingToolCallIds`), CopilotKit reports
        // status `"inProgress"` even though `function.arguments` is fully
        // streamed in. Gating on that status would blank the card forever.
        // `parameters` is the partial-JSON-parse of `function.arguments`, so we
        // guard on the fields actually being present instead.
        const { id, from, subject, intent } = parameters;
        if (
          id === undefined ||
          from === undefined ||
          subject === undefined ||
          intent === undefined
        ) {
          return <></>;
        }
        return <LeadCard lead={{ id, from, subject, intent }} />;
      },
    },
    [],
  );

  // confirmSend -> <ApprovalDialog ... />  (renders the stub for now;
  // Task 4 replaces this with a real human-in-the-loop resume via respond()).
  useRenderTool(
    {
      name: "confirmSend",
      parameters: z.object({}).passthrough(),
      render: ({ parameters }) => {
        // Same rationale as renderLead: historical tool calls surfaced from
        // `agent.messages` arrive with status "inProgress", so we don't gate on
        // it. (Task 4 replaces this with a real human-in-the-loop resume.)
        return <ApprovalDialog data={parameters} />;
      },
    },
    [],
  );
}
