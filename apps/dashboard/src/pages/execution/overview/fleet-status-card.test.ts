import { describe, it, expect } from 'vitest';
import { FleetStatusCard, computeFleetCounts } from './fleet-status-card.js';

describe('FleetStatusCard', () => {
  it('exports FleetStatusCard as a function', () => {
    expect(typeof FleetStatusCard).toBe('function');
  });
});

describe('computeFleetCounts', () => {
  it('counts workers by status', () => {
    const workers = [
      { status: 'online' },
      { status: 'busy' },
      { status: 'online' },
      { status: 'offline' },
    ];
    expect(computeFleetCounts(workers)).toEqual({ online: 2, busy: 1, idle: 0, down: 1 });
  });

  it('returns zeros for empty array', () => {
    expect(computeFleetCounts([])).toEqual({ online: 0, busy: 0, idle: 0, down: 0 });
  });

  it('counts idle workers', () => {
    const workers = [{ status: 'idle' }, { status: 'idle' }];
    expect(computeFleetCounts(workers)).toEqual({ online: 0, busy: 0, idle: 2, down: 0 });
  });

  it('treats unknown status as down', () => {
    const workers = [{ status: 'unknown' }, { status: 'error' }];
    expect(computeFleetCounts(workers)).toEqual({ online: 0, busy: 0, idle: 0, down: 2 });
  });

  it('counts all statuses together', () => {
    const workers = [
      { status: 'online' },
      { status: 'busy' },
      { status: 'idle' },
      { status: 'offline' },
    ];
    expect(computeFleetCounts(workers)).toEqual({ online: 1, busy: 1, idle: 1, down: 1 });
  });
});
