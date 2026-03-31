import { describe, expect, it } from 'vitest';

import { MissionControlLiveService } from '../../../../src/services/workflow-operations/mission-control-live-service.js';
import { createSequencedPool } from './test-helpers.js';

describe('MissionControlLiveService', () => {
  it('composes workflow cards, sections, and attention items from workflow and signal rows', async () => {
    const pool = createSequencedPool([
      { rows: [{ latest_event_id: 42 }], rowCount: 1 },
      {
        rows: [
          {
            id: 'workflow-1',
            name: 'Release Workflow',
            state: 'active',
            lifecycle: 'planned',
            current_stage: 'implementation',
            workspace_id: 'workspace-1',
            workspace_name: 'Core Product',
            playbook_id: 'playbook-1',
            playbook_name: 'Release',
            parameters: {},
            context: {},
            updated_at: '2026-03-27T04:00:00.000Z',
          },
        ],
        rowCount: 1,
      },
      {
        rows: [
          {
            workflow_id: 'workflow-1',
            waiting_for_decision_count: 1,
            open_escalation_count: 0,
            blocked_work_item_count: 0,
            failed_task_count: 0,
            active_task_count: 1,
            active_work_item_count: 1,
            pending_work_item_count: 1,
            recoverable_issue_count: 0,
          },
        ],
        rowCount: 1,
      },
      { rows: [], rowCount: 0 },
      {
        rows: [
          {
            workflow_id: 'workflow-1',
            document_id: 'document-1',
            logical_name: 'release-brief',
            title: 'Release brief',
            source: 'artifact',
            location: 'deliverables/release-brief.md',
            artifact_id: 'artifact-1',
          },
        ],
        rowCount: 1,
      },
    ]);

    const service = new MissionControlLiveService(pool as never);
    const response = await service.getLive('tenant-1');

    expect(response.version.latestEventId).toBe(42);
    expect(response.sections).toEqual([
      expect.objectContaining({
        id: 'needs_action',
        count: 1,
        workflows: [
          expect.objectContaining({
            id: 'workflow-1',
            posture: 'needs_decision',
            outputDescriptors: [
              expect.objectContaining({
                id: 'document:document-1',
                title: 'Release brief',
              }),
            ],
          }),
        ],
      }),
    ]);
    expect(response.attentionItems).toEqual([
      {
        id: 'attention:workflow-1',
        lane: 'needs_decision',
        title: 'Decision required',
        workflowId: 'workflow-1',
        summary: 'Waiting on operator decisions',
      },
    ]);
  });

  it('hydrates artifact output descriptors with their parent work-item ids', async () => {
    const pool = createSequencedPool([
      {
        rows: [
          {
            workflow_id: 'workflow-1',
            artifact_id: 'artifact-1',
            task_id: 'task-1',
            work_item_id: 'work-item-1',
            stage_name: 'review',
            work_item_completed_at: null,
            workflow_state: 'active',
            logical_path: 'deliverables/release-notes.md',
            content_type: 'text/markdown',
          },
        ],
        rowCount: 1,
      },
      { rows: [], rowCount: 0 },
    ]);

    const service = new MissionControlLiveService(pool as never);
    const outputs = await service.listWorkflowOutputDescriptors('tenant-1', ['workflow-1'], 1);

    expect(outputs.get('workflow-1')).toEqual([
      expect.objectContaining({
        id: 'artifact:artifact-1',
        workItemId: 'work-item-1',
        taskId: 'task-1',
      }),
    ]);
  });

  it('marks artifact output descriptors final when their parent work item is completed', async () => {
    const pool = createSequencedPool([
      {
        rows: [
          {
            workflow_id: 'workflow-1',
            artifact_id: 'artifact-1',
            task_id: 'task-1',
            work_item_id: 'work-item-1',
            stage_name: 'review',
            work_item_completed_at: '2026-03-27T22:50:00.000Z',
            workflow_state: 'active',
            logical_path: 'deliverables/release-notes.md',
            content_type: 'text/markdown',
          },
        ],
        rowCount: 1,
      },
      { rows: [], rowCount: 0 },
    ]);

    const service = new MissionControlLiveService(pool as never);
    const outputs = await service.listWorkflowOutputDescriptors('tenant-1', ['workflow-1'], 1);

    expect(outputs.get('workflow-1')).toEqual([
      expect.objectContaining({
        id: 'artifact:artifact-1',
        status: 'final',
      }),
    ]);
  });

  it('uses orchestration copy instead of generic task-in-flight copy before board work exists', async () => {
    const pool = createSequencedPool([
      { rows: [{ latest_event_id: 9 }], rowCount: 1 },
      {
        rows: [
          {
            id: 'workflow-2',
            name: 'Fresh Workflow',
            state: 'active',
            lifecycle: 'planned',
            current_stage: null,
            workspace_id: 'workspace-1',
            workspace_name: 'Core Product',
            playbook_id: 'playbook-1',
            playbook_name: 'Release',
            parameters: {},
            context: {},
            updated_at: '2026-03-27T04:00:00.000Z',
          },
        ],
        rowCount: 1,
      },
      {
        rows: [
          {
            workflow_id: 'workflow-2',
            waiting_for_decision_count: 0,
            open_escalation_count: 0,
            blocked_work_item_count: 0,
            failed_task_count: 0,
            active_task_count: 1,
            active_work_item_count: 0,
            pending_work_item_count: 0,
            recoverable_issue_count: 0,
          },
        ],
        rowCount: 1,
      },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ]);

    const service = new MissionControlLiveService(pool as never);
    const response = await service.getLive('tenant-1');

    expect(response.sections[0]?.workflows[0]?.pulse.summary).toBe('Orchestrating the next step');
  });

  it('describes pre-specialist work as routing when pending work is still being assigned', async () => {
    const pool = createSequencedPool([
      { rows: [{ latest_event_id: 10 }], rowCount: 1 },
      {
        rows: [
          {
            id: 'workflow-4',
            name: 'Routing Workflow',
            state: 'active',
            lifecycle: 'planned',
            current_stage: null,
            workspace_id: 'workspace-1',
            workspace_name: 'Core Product',
            playbook_id: 'playbook-1',
            playbook_name: 'Release',
            parameters: {},
            context: {},
            updated_at: '2026-03-27T04:00:00.000Z',
          },
        ],
        rowCount: 1,
      },
      {
        rows: [
          {
            workflow_id: 'workflow-4',
            waiting_for_decision_count: 0,
            open_escalation_count: 0,
            blocked_work_item_count: 0,
            failed_task_count: 0,
            active_task_count: 1,
            active_work_item_count: 0,
            pending_work_item_count: 2,
            recoverable_issue_count: 0,
          },
        ],
        rowCount: 1,
      },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ]);

    const service = new MissionControlLiveService(pool as never);
    const response = await service.getLive('tenant-1');

    expect(response.sections[0]?.workflows[0]?.pulse.summary).toBe('Routing new work');
  });

  it('derives pending live counts without relying on entry-lane column math', async () => {
    const pool = createSequencedPool([
      { rows: [{ latest_event_id: 11 }], rowCount: 1 },
      {
        rows: [
          {
            id: 'workflow-queued',
            name: 'Queued Workflow',
            state: 'pending',
            lifecycle: 'planned',
            current_stage: null,
            workspace_id: 'workspace-1',
            workspace_name: 'Core Product',
            playbook_id: 'playbook-1',
            playbook_name: 'Release',
            parameters: {},
            context: {},
            updated_at: '2026-03-27T04:00:00.000Z',
          },
        ],
        rowCount: 1,
      },
      {
        rows: [
          {
            workflow_id: 'workflow-queued',
            waiting_for_decision_count: 0,
            open_escalation_count: 0,
            blocked_work_item_count: 0,
            failed_task_count: 0,
            active_task_count: 0,
            active_work_item_count: 0,
            pending_work_item_count: 1,
            recoverable_issue_count: 0,
          },
        ],
        rowCount: 1,
      },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ]);

    const service = new MissionControlLiveService(pool as never);
    const response = await service.getLive('tenant-1');

    expect(pool.query).toHaveBeenNthCalledWith(3, expect.not.stringContaining('board_config.entry_column_id'), expect.any(Array));
    expect(pool.query).toHaveBeenNthCalledWith(3, expect.not.stringContaining('wi.column_id <>'), expect.any(Array));
    expect(pool.query).toHaveBeenNthCalledWith(3, expect.not.stringContaining('wi.column_id ='), expect.any(Array));
    expect(response.sections).toEqual([
      expect.objectContaining({
        id: 'waiting',
        workflows: [
          expect.objectContaining({
            id: 'workflow-queued',
            posture: 'waiting_by_design',
            pulse: expect.objectContaining({
              summary: 'Workflow is queued for the next workflow event',
            }),
            metrics: expect.objectContaining({
              activeTaskCount: 0,
              activeWorkItemCount: 0,
            }),
          }),
        ],
      }),
    ]);
  });
});
