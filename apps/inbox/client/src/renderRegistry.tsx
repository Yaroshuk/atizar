import type { ComponentType } from "react";
import { LeadCard } from "./components/LeadCard";
import { ApprovalDialog } from "./components/ApprovalDialog";

// Maps the component *names* referenced by `def.renders` to real React
// components. Keeps the shared passport (core/) free of React imports.
export const renderRegistry: Record<string, ComponentType<any>> = {
  LeadCard,
  ApprovalDialog,
};
