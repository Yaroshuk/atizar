// Per-agent concurrency cap + FIFO overflow queue. Occupancy is DERIVED from the DB (U5) via an
// injected `activeCount(agentId)` query — the in-memory counter is GONE, so a leaked/double-freed/
// restart-lost slot is structurally impossible. The FIFO queue stays (legitimately process-local
// ordering, rebuilt by the boot sweep). maxInstances cap + queue semantics are UNCHANGED.
//
// To hold the cap against a same-tick burst, the pool OWNS the queued→active flip at admission:
// per-agent admission is serialized by an async mutex (a promise chain), and within it the pool
// awaits a COMMITTED `activate(id)` (transition queued→active) BEFORE the next `activeCount` read —
// so the count never goes stale mid-batch. Only then is `run(id)` kicked off; the observer's run()
// no longer does the start transition (U7b). (Old race: transition('start') landed asynchronously
// inside run() AFTER pump returned, so two overlapping pumps read a stale low count and over-
// admitted.) The mutex suffices for a single server process; a Postgres advisory lock is the
// drop-in upgrade for multi-process admission.

interface AgentSlot {
  cap: number
  queue: string[]
  // Per-agent admission mutex: a promise chain so only one pump body runs at a time for the agent.
  lock: Promise<void>
}

export interface WorkerPool {
  enqueue(id: string, agentId: string, cap: number): void
  dequeue(id: string, agentId: string): void
  // Re-derive occupancy from the DB and start the next queued id if a slot is free. Replaces the
  // old release()/resumeAcquire() counter mutations. Called after every terminal write (settle)
  // and after a gate suspend.
  reconcile(agentId: string): void
  activeCount(agentId: string): Promise<number>
  queuedCount(agentId: string): number
}

export interface WorkerPoolDeps {
  run: (id: string) => void
  // DB-backed occupancy. Async because it queries Postgres.
  activeCount: (agentId: string) => Promise<number>
  // Flip a queued id to active (committed) BEFORE its run starts — the pool owns this so the cap
  // holds against a same-tick burst. = transition(db, id, 'start'). May throw if the id raced out
  // of 'queued' (e.g. cancelled); pump drops it and continues.
  activate: (id: string) => Promise<void>
}

export function makeWorkerPool(deps: WorkerPoolDeps): WorkerPool {
  const slots = new Map<string, AgentSlot>()

  const slot = (agentId: string, cap: number): AgentSlot => {
    let s = slots.get(agentId)
    if (!s) {
      s = { cap, queue: [], lock: Promise.resolve() }
      slots.set(agentId, s)
    }
    s.cap = cap
    return s
  }

  // Serialize admission per agent: chain each pump body on the agent's lock so two pumps (an
  // enqueue racing a reconcile) can't both read the same stale count and over-admit. Awaiting the
  // committed activate() before the next loop iteration is what actually keeps the count fresh.
  const pump = (agentId: string): void => {
    const s = slots.get(agentId)
    if (!s) return
    s.lock = s.lock
      .then(async () => {
        let active = await deps.activeCount(agentId)
        while (active < s.cap && s.queue.length > 0) {
          const next = s.queue.shift()!
          try {
            await deps.activate(next) // queued→active, committed — the next read reflects it
          } catch {
            continue // raced out of 'queued' (cancelled) — drop it, try the next
          }
          active++
          deps.run(next)
        }
      })
      .catch((e) => {
        // Keep the per-agent chain alive even if a pump body throws (e.g. a transient DB error in
        // activeCount/activate) — but surface it; a silent stall would be undiagnosable.
        console.error('[workerPool] pump failed for', agentId, e)
      })
  }

  return {
    enqueue(id, agentId, cap) {
      const s = slot(agentId, cap)
      s.queue.push(id)
      pump(agentId)
    },

    dequeue(id, agentId) {
      const s = slots.get(agentId)
      if (!s) return
      const i = s.queue.indexOf(id)
      if (i !== -1) s.queue.splice(i, 1)
    },

    reconcile(agentId) {
      pump(agentId)
    },

    activeCount(agentId) {
      return deps.activeCount(agentId)
    },

    queuedCount(agentId) {
      return slots.get(agentId)?.queue.length ?? 0
    },
  }
}
