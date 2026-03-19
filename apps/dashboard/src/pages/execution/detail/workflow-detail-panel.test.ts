import { describe, it, expect } from 'vitest';
import { WorkflowDetailPanel } from './workflow-detail-panel.js';
import { formatElapsed, isWorkflowLive } from './workflow-detail-panel-support.js';

describe('WorkflowDetailPanel', () => {
  it('exports WorkflowDetailPanel', () => expect(typeof WorkflowDetailPanel).toBe('function'));
});

describe('formatElapsed', () => {
  it('formats minutes', () => expect(formatElapsed(120000)).toBe('2m'));
  it('formats hours and minutes', () => expect(formatElapsed(5000000)).toBe('1h 23m'));
  it('formats zero', () => expect(formatElapsed(0)).toBe('0m'));
});

describe('isWorkflowLive', () => {
  it('returns true for active', () => expect(isWorkflowLive('active')).toBe(true));
  it('returns false for completed', () => expect(isWorkflowLive('completed')).toBe(false));
});
