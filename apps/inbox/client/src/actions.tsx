import { useHumanInTheLoop, useRenderTool } from "@copilotkit/react-core/v2";
import { useRef } from "react";
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
//
// `onApprovalPending` (optional) is invoked with `true` while the confirmSend
// human-in-the-loop tool is `executing` (run paused, ApprovalDialog awaiting
// the user) and `false` once it leaves that state (approved/resolved). This is
// the cleanest source for the AgentCard's "awaiting_approval" status — it is
// scoped exactly to the window where `respond` is live.
export function useInboxActions(opts?: {
  onApprovalPending?: (pending: boolean) => void;
}) {
  const onApprovalPending = opts?.onApprovalPending;
  // Last pending value reported to the parent, so we only fire on transitions
  // and defer the call out of render (avoids setState-during-render).
  const lastPending = useRef<boolean | null>(null);
  const reportPending = (pending: boolean) => {
    if (!onApprovalPending || lastPending.current === pending) return;
    lastPending.current = pending;
    queueMicrotask(() => onApprovalPending(pending));
  };
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
        // Surface "awaiting_approval" exactly while the run is paused for the
        // human: the tool call is `executing` and `respond` is live.
        reportPending(status === "executing" && !!respond);
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
