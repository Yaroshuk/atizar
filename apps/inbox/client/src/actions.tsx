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
      render: ({ status, parameters }) => {
        // While args are still streaming in, fields may be partial.
        if (status === "inProgress") return <></>;
        return <LeadCard lead={parameters} />;
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
      render: ({ status, parameters }) => {
        if (status === "inProgress") return <></>;
        return <ApprovalDialog data={parameters} />;
      },
    },
    [],
  );
}
