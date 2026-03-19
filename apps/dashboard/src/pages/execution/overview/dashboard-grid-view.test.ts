import { describe, it, expect } from 'vitest';
import { DashboardGridView, computeMetrics } from './dashboard-grid-view';

describe('DashboardGridView', () => {
  it('exports DashboardGridView', () => expect(typeof DashboardGridView).toBe('function'));
});

describe('computeMetrics', () => {
  it('counts active workflows', () => {
    const workflows = [
      { id: '1', name: 'A', state: 'active' },
      { id: '2', name: 'B', state: 'completed' },
      { id: '3', name: 'C', state: 'active' },
    ];
    const m = computeMetrics(workflows, 14.28);
    expect(m.active).toBe(2);
    expect(m.completed).toBe(1);
    expect(m.spend).toBe('$14.28');
  });

  it('counts attention items', () => {
    const workflows = [
      { id: '1', name: 'A', state: 'failed' },
      { id: '2', name: 'B', state: 'active', gateWaiting: true },
    ];
    expect(computeMetrics(workflows, 0).attention).toBe(2);
  });
});
