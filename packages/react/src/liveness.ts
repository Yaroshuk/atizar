import type { Status } from './status'

// SINGLE SOURCE for "live or not" (replaces pipelineModel.ACTIVE, aggregate.BUSY, and the
// inline running/awaiting set in InstancePickerModal). Two questions over the ONE Status:
// they differ ONLY on `error`.
//
//   isLive  — shown in the live UI (pipeline node, card overlay, picker, open-routing).
//             Includes `error` (per spec §1/§7: an unacknowledged crash stays visible; once the
//             acknowledge edge moves the run's Outcome off `error`, displayStatus no longer yields
//             the `error` Status and the instance recedes automatically — no separate flag).
//   isBusy  — occupies the agent's slot (the START-slot gate, the "N active" rollup count).
//             Excludes `error`: a crashed input agent has a FREE slot, so START must stay.
const LIVE: ReadonlySet<Status> = new Set(['running', 'awaiting_approval', 'error'])
const BUSY: ReadonlySet<Status> = new Set(['running', 'awaiting_approval'])

export const isLive = (status: Status): boolean => LIVE.has(status)
export const isBusy = (status: Status): boolean => BUSY.has(status)
