import { ConflictError } from '../errors/domain-errors.js';

/**
 * Valid worker lifecycle states.
 *
 * `disconnected` is a transient state entered when the heartbeat monitor detects
 * a missed heartbeat beyond the offline threshold.  The worker remains in
 * `disconnected` for a configurable grace period (WORKER_OFFLINE_GRACE_PERIOD_MS)
 * before transitioning to `offline`, at which point its tasks are requeued.
 */
export type WorkerState = 'online' | 'busy' | 'draining' | 'degraded' | 'disconnected' | 'offline';

const allowedTransitions: Record<WorkerState, WorkerState[]> = {
  online: ['busy', 'draining', 'degraded', 'disconnected', 'offline'],
  busy: ['online', 'draining', 'degraded', 'disconnected', 'offline'],
  draining: ['busy', 'disconnected', 'offline'],
  degraded: ['online', 'busy', 'disconnected', 'offline'],
  disconnected: ['online', 'offline'],
  offline: ['online'],
};

export function assertValidWorkerTransition(workerId: string, from: WorkerState, to: WorkerState): void {
  if (from === to) {
    return;
  }
  if (!allowedTransitions[from].includes(to)) {
    throw new ConflictError(`Invalid worker transition for ${workerId}: ${from} -> ${to}`);
  }
}
