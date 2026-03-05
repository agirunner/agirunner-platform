import { describe, expect, it } from 'vitest';

import { shouldInvalidatePipelineRealtimeEvent, summarizeTasks } from './pipeline-detail-page.js';

describe('pipeline mission-control summary', () => {
  it('counts task states into mission-control buckets', () => {
    const summary = summarizeTasks([
      { state: 'ready' },
      { state: 'running' },
      { state: 'awaiting_approval' },
      { state: 'completed' },
      { state: 'failed' },
      { state: 'cancelled' },
      { state: 'blocked' },
    ]);

    expect(summary).toEqual({
      total: 7,
      ready: 1,
      running: 1,
      blocked: 2,
      completed: 1,
      failed: 2,
    });
  });
});

describe('pipeline detail realtime invalidation scope', () => {
  it('invalidates on pipeline events only when entity matches current pipeline', () => {
    expect(
      shouldInvalidatePipelineRealtimeEvent('pipeline.state_changed', 'pipe-1', {
        entity_type: 'pipeline',
        entity_id: 'pipe-1',
      }),
    ).toBe(true);

    expect(
      shouldInvalidatePipelineRealtimeEvent('pipeline.state_changed', 'pipe-1', {
        entity_type: 'pipeline',
        entity_id: 'pipe-2',
      }),
    ).toBe(false);
  });

  it('invalidates task events only when payload carries matching pipeline id', () => {
    expect(
      shouldInvalidatePipelineRealtimeEvent('task.state_changed', 'pipe-1', {
        data: { pipeline_id: 'pipe-1' },
      }),
    ).toBe(true);

    expect(
      shouldInvalidatePipelineRealtimeEvent('task.state_changed', 'pipe-1', {
        data: { pipeline_id: 'pipe-2' },
      }),
    ).toBe(false);
  });

  it('ignores task events without pipeline id to prevent cross-pipeline churn', () => {
    expect(
      shouldInvalidatePipelineRealtimeEvent('task.state_changed', 'pipe-1', {
        entity_type: 'task',
        entity_id: 'task-abc',
        data: { from_state: 'ready', to_state: 'running' },
      }),
    ).toBe(false);
  });
});
