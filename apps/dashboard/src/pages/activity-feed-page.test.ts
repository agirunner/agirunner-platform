import { describe, expect, it, vi } from 'vitest';

import { normalizeActivityEvent } from './activity-feed-page.js';

describe('activity feed normalization', () => {
  it('maps stream payload fields to activity feed row fields', () => {
    const normalized = normalizeActivityEvent('task.state_changed', {
      id: 42,
      type: 'task.state_changed',
      entity_type: 'task',
      entity_id: 'task-1',
      actor_type: 'worker',
      actor_id: 'worker-1',
      created_at: '2026-03-05T17:00:00.000Z',
    });

    expect(normalized).toEqual({
      id: '42',
      type: 'task.state_changed',
      entityType: 'task',
      entityId: 'task-1',
      actorType: 'worker',
      actorId: 'worker-1',
      createdAt: '2026-03-05T17:00:00.000Z',
    });
  });

  it('fills defaults when payload fields are absent', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-05T17:01:00.000Z'));

    const normalized = normalizeActivityEvent('pipeline.updated', {});

    expect(normalized.type).toBe('pipeline.updated');
    expect(normalized.entityType).toBe('system');
    expect(normalized.actorType).toBe('system');
    expect(normalized.createdAt).toBe('2026-03-05T17:01:00.000Z');

    vi.useRealTimers();
  });
});
