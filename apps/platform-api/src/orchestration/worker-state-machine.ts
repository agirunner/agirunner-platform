import { ConflictError } from '../errors/domain-errors.js';

export type WorkerState = 'online' | 'busy' | 'draining' | 'degraded' | 'offline';

const allowedTransitions: Record<WorkerState, WorkerState[]> = {
  online: ['busy', 'draining', 'degraded', 'offline'],
  busy: ['online', 'draining', 'degraded', 'offline'],
  draining: ['busy', 'offline'],
  degraded: ['online', 'busy', 'offline'],
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
