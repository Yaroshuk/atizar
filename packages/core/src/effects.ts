// A server-executed effect: keyed by APPROVAL tool name, called by the server on approve
// with the gate form (the edited artifact = the args) + context. Returns the result that
// becomes the ledger entry + the resume narrative. The model never sees this function.
export type EffectFn = (
  form: Record<string, unknown>,
  ctx: { workItemId: string; gateId: string }
) => Promise<Record<string, unknown>>
