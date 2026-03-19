import { describe, it, expect } from 'vitest';
import { WarRoomView, sortWorkflowsByAttention } from './war-room-view.js';

describe('WarRoomView', () => {
  it('exports WarRoomView as a function', () => {
    expect(typeof WarRoomView).toBe('function');
  });
});

describe('sortWorkflowsByAttention', () => {
  it('puts failed workflows first', () => {
    const workflows = [
      { id: '1', name: 'Active', state: 'active' },
      { id: '2', name: 'Failed', state: 'failed' },
      { id: '3', name: 'Completed', state: 'completed' },
    ];
    const sorted = sortWorkflowsByAttention(workflows);
    expect(sorted[0].state).toBe('failed');
    expect(sorted[1].state).toBe('active');
    expect(sorted[2].state).toBe('completed');
  });

  it('puts gate-waiting before active', () => {
    const workflows = [
      { id: '1', name: 'Active', state: 'active' },
      { id: '2', name: 'Gate', state: 'active', gateWaiting: true },
    ];
    const sorted = sortWorkflowsByAttention(workflows);
    expect(sorted[0].id).toBe('2');
  });

  it('returns empty array for empty input', () => {
    expect(sortWorkflowsByAttention([])).toEqual([]);
  });
});
