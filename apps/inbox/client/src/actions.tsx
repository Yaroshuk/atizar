import { useHumanInTheLoop, useRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { LeadCard } from "./components/LeadCard";
import { ApprovalDialog } from "./components/ApprovalDialog";

// Generative-UI registration for the inbox agent.
//
// In CopilotKit v2 (1.59) agent-emitted tool calls are mapped to React
// components. Two hooks are used here:
//
//  - `useRenderTool`  — pure generative UI (no human response). Used for
//    `renderLead` -> <LeadCard />.
//  - `useHumanInTheLoop` — generative UI that PAUSES the agent run until the
//    human responds. Used for `confirmSend` -> <ApprovalDialog />. The hook
//    registers a frontend tool whose `handler` returns a Promise that stays
//    pending until the user acts; its `render` receives a `respond(result)`
//    callback while `status === "executing"`. Calling `respond(...)` resolves
//    that Promise, the framework records a `role:"tool"` message with the
//    matching `toolCallId`, and (followUp default) re-runs the agent — the
//    resume turn the server detects in `approvalResolved`.
//
// Call `useInboxActions()` inside a component nested under <CopilotKit>.
export function useInboxActions() {
  // renderLead -> <LeadCard lead={...} />
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

  // confirmSend -> <ApprovalDialog ... /> via human-in-the-loop.
  //
  // `args` is typed by the schema; `respond` is only present while the tool
  // call is `executing` (i.e. the run has paused waiting for the human). We
  // render the dialog with the streamed args and, when `respond` is available,
  // wire the "Отправить" button to `respond("approved")` to resume the agent.
  // After the human approves the tool call becomes `complete` (a tool message
  // exists) and `respond` is undefined — we keep showing the dialog text but
  // the button is inert.
  useHumanInTheLoop<{ leadId: number; message: string }>(
    {
      name: "confirmSend",
      parameters: z.object({
        leadId: z.number(),
        message: z.string(),
      }),
      render: ({ args, status, respond }) => {
        if (args.leadId === undefined || args.message === undefined) {
          return <></>;
        }
        const data = { leadId: args.leadId, message: args.message };
        return (
          <ApprovalDialog
            data={data}
            onApprove={() => {
              if (status === "executing" && respond) {
                void respond("approved");
              }
            }}
          />
        );
      },
    },
    [],
  );
}
