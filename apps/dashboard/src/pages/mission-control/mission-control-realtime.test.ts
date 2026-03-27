import { describe, expect, it } from 'vitest';

import {
  buildMissionControlHistoryQueryKey,
  buildMissionControlLiveQueryKey,
  buildMissionControlRecentQueryKey,
  buildMissionControlWorkspaceQueryKey,
  shouldInvalidateMissionControlRealtimeEvent,
} from './mission-control-realtime.js';

describe('mission control realtime support', () => {
  it('builds stable query keys for live, recent, history, and workflow workspace data', () => {
    expect(buildMissionControlLiveQueryKey({ scope: 'entire-tenant', savedView: 'all-active' })).toEqual([
      'mission-control',
      'live',
      'entire-tenant',
      'all-active',
    ]);
    expect(buildMissionControlRecentQueryKey({ scope: 'watchlist', savedView: 'shipping' })).toEqual([
      'mission-control',
      'recent',
      'watchlist',
      'shipping',
    ]);
    expect(
      buildMissionControlHistoryQueryKey({
        scope: 'entire-tenant',
        savedView: 'all-active',
        workflowId: 'workflow-1',
      }),
    ).toEqual(['mission-control', 'history', 'entire-tenant', 'all-active', 'workflow-1']);
    expect(buildMissionControlWorkspaceQueryKey('workflow-1')).toEqual([
      'mission-control',
      'workspace',
      'workflow-1',
    ]);
  });

  it('invalidates on workflow, work item, task, and output-producing events only', () => {
    expect(
      shouldInvalidateMissionControlRealtimeEvent('workflow.state_changed', {
        entity_type: 'workflow',
        entity_id: 'workflow-1',
      }),
    ).toBe(true);
    expect(
      shouldInvalidateMissionControlRealtimeEvent('task.state_changed', {
        entity_type: 'task',
        entity_id: 'task-1',
        data: { workflow_id: 'workflow-1' },
      }),
    ).toBe(true);
    expect(
      shouldInvalidateMissionControlRealtimeEvent('workflow_document.published', {
        entity_type: 'workflow_document',
        entity_id: 'doc-1',
        data: { workflow_id: 'workflow-1' },
      }),
    ).toBe(true);
    expect(
      shouldInvalidateMissionControlRealtimeEvent('worker.heartbeat', {
        entity_type: 'worker',
        entity_id: 'worker-1',
      }),
    ).toBe(false);
  });
});
