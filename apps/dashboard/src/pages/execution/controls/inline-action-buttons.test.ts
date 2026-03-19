import { describe, it, expect } from 'vitest';
import { InlineActionButtons, getAvailableActions } from './inline-action-buttons.js';

describe('InlineActionButtons', () => {
  it('exports InlineActionButtons', () => expect(typeof InlineActionButtons).toBe('function'));
});

describe('getAvailableActions', () => {
  it('returns pause+cancel for active workflow', () => {
    expect(getAvailableActions('workflow', 'active')).toEqual(['pause', 'cancel']);
  });

  it('returns resume+cancel for paused workflow', () => {
    expect(getAvailableActions('workflow', 'paused')).toEqual(['resume', 'cancel']);
  });

  it('returns empty for completed workflow', () => {
    expect(getAvailableActions('workflow', 'completed')).toEqual([]);
  });

  it('returns empty for failed workflow', () => {
    expect(getAvailableActions('workflow', 'failed')).toEqual([]);
  });

  it('returns empty for cancelled workflow', () => {
    expect(getAvailableActions('workflow', 'cancelled')).toEqual([]);
  });

  it('returns retry+cancel for failed task', () => {
    expect(getAvailableActions('task', 'failed')).toEqual(['retry', 'cancel']);
  });

  it('returns cancel for active task', () => {
    expect(getAvailableActions('task', 'active')).toEqual(['cancel']);
  });

  it('returns empty for completed task', () => {
    expect(getAvailableActions('task', 'completed')).toEqual([]);
  });

  it('returns gate actions for requested gate', () => {
    expect(getAvailableActions('gate', 'requested')).toEqual(['approve', 'reject', 'request_changes']);
  });

  it('returns empty for approved gate', () => {
    expect(getAvailableActions('gate', 'approved')).toEqual([]);
  });

  it('returns empty for unknown entity type', () => {
    expect(getAvailableActions('unknown', 'active')).toEqual([]);
  });
});
