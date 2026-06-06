import { useEffect, useState } from "react";
import type { Status } from "./components/AgentCard";

// Derives the AgentCard status from the agent's REAL run lifecycle.
//
// The installed `@ag-ui/client` AbstractAgent exposes:
//   agent.subscribe(subscriber) => { unsubscribe }
// with the lifecycle callbacks `onRunStartedEvent`, `onRunFinalized`,
// `onRunFailed` (verified against node_modules/@ag-ui/client/dist/index.d.ts).
//
// We map:
//   onRunStartedEvent -> "running"
//   onRunFinalized    -> "done"   (fires after the run + any follow-up settle)
//   onRunFailed       -> "error"
//
// `awaiting_approval` is NOT a lifecycle event — the run is still "running"
// (paused) while the human-in-the-loop confirmSend tool awaits the user. So we
// take that signal externally (`awaitingApproval`, driven by the confirmSend
// tool's `status === "executing"`, see actions.tsx) and let it override
// "running". It clears the moment the user approves (tool leaves executing),
// after which onRunFinalized lands "done".
export function useAgentStatus(
  agent: { subscribe: (s: any) => { unsubscribe: () => void } },
  awaitingApproval: boolean,
): Status {
  const [lifecycle, setLifecycle] = useState<
    "idle" | "running" | "done" | "error"
  >("idle");

  useEffect(() => {
    const { unsubscribe } = agent.subscribe({
      onRunStartedEvent: () => setLifecycle("running"),
      onRunFinalized: () => setLifecycle("done"),
      onRunFailed: () => setLifecycle("error"),
    });
    return () => unsubscribe();
  }, [agent]);

  // While the confirmSend dialog awaits the human, surface that explicitly —
  // but never let it mask a terminal error.
  if (awaitingApproval && lifecycle !== "error") return "awaiting_approval";
  return lifecycle;
}
