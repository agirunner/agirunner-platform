import { describe, expect, it } from 'vitest';

import { buildWorkflowInspectorMemoryPacket } from './workflow-inspector-memory-packet.js';

describe('workflow inspector memory packet', () => {
  it('builds changed-field clues and diff payloads for updated memory entries', () => {
    const packet = buildWorkflowInspectorMemoryPacket({
      focusWorkItem: {
        id: 'work-item-1',
        title: 'Review release notes',
        stageName: 'review',
        nextExpectedActor: null,
        nextExpectedAction: null,
        unresolvedFindingsCount: 0,
        assessmentFocusCount: 0,
        knownRiskCount: 0,
        latestHandoffCompletion: null,
      },
      memoryHistory: [
        {
          key: 'release_risk',
          value: { level: 'high', owner: 'qa' },
          event_id: 11,
          event_type: 'updated',
          updated_at: '2026-03-10T05:00:00Z',
          actor_type: 'agent',
          actor_id: 'agent-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-1',
          stage_name: 'review',
        },
        {
          key: 'release_risk',
          value: { level: 'medium', owner: 'build' },
          event_id: 10,
          event_type: 'updated',
          updated_at: '2026-03-10T04:00:00Z',
          actor_type: 'agent',
          actor_id: 'agent-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-1',
          stage_name: 'review',
        },
      ],
      now: Date.parse('2026-03-10T05:30:00Z'),
    });

    expect(packet.changes[0]).toEqual(
      expect.objectContaining({
        key: 'release_risk',
        status: 'Updated',
        changedFields: ['level', 'owner'],
        canRenderDiff: true,
      }),
    );
    expect(packet.changes[0].previousText).toContain('"owner": "build"');
    expect(packet.changes[0].currentText).toContain('"owner": "qa"');
  });

  it('keeps created and deleted memory revisions inspectable', () => {
    const packet = buildWorkflowInspectorMemoryPacket({
      focusWorkItem: {
        id: 'work-item-2',
        title: 'QA handoff',
        stageName: 'qa',
        nextExpectedActor: null,
        nextExpectedAction: null,
        unresolvedFindingsCount: 0,
        assessmentFocusCount: 0,
        knownRiskCount: 0,
        latestHandoffCompletion: null,
      },
      memoryHistory: [
        {
          key: 'release_notes',
          value: 'Ready for QA',
          event_id: 9,
          event_type: 'deleted',
          updated_at: '2026-03-10T03:00:00Z',
          actor_type: 'system',
          actor_id: null,
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-2',
          task_id: null,
          stage_name: 'qa',
        },
        {
          key: 'release_notes',
          value: 'Ready for QA',
          event_id: 8,
          event_type: 'updated',
          updated_at: '2026-03-10T02:00:00Z',
          actor_type: 'agent',
          actor_id: 'agent-2',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-2',
          task_id: 'task-2',
          stage_name: 'qa',
        },
        {
          key: 'status',
          value: 'waiting',
          event_id: 7,
          event_type: 'updated',
          updated_at: '2026-03-10T01:00:00Z',
          actor_type: 'agent',
          actor_id: 'agent-2',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-2',
          task_id: 'task-2',
          stage_name: 'qa',
        },
      ],
      now: Date.parse('2026-03-10T05:30:00Z'),
    });

    expect(packet.changes[0]).toEqual(
      expect.objectContaining({
        key: 'release_notes',
        status: 'Deleted',
        changedFields: ['value'],
        canRenderDiff: true,
      }),
    );
    expect(packet.changes[0].currentText).toBe('');
    expect(packet.changes.find((change) => change.key === 'status')).toEqual(
      expect.objectContaining({
        key: 'status',
        status: 'Created',
        canRenderDiff: true,
      }),
    );
  });
});
