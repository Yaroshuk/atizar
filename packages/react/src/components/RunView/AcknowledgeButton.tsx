// The error-analogue of the gate's approve/reject: a single "OK / Got it" affordance shown on an
// errored run. Clicking it acknowledges the error (server settles off `error` → `dismissed`), so
// the run recedes from the live UI. Generic wording — per-workflow phrasing is policy, not here.
export type AcknowledgeButtonProps = {
  onAcknowledge: () => void
}

export const AcknowledgeButton = ({ onAcknowledge }: AcknowledgeButtonProps) => (
  <button className='btn btn-ghost' onClick={onAcknowledge}>
    OK / Got it
  </button>
)
