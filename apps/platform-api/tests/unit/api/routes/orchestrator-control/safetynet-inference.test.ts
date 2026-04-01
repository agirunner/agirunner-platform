import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/services/safetynet/logging.js', () => ({
  logSafetynetTriggered: vi.fn(),
}));

import { normalizeOrchestratorWorkItemCreateInput } from '../../../../../src/api/routes/orchestrator-control/activation-context.js';
import { alignOrchestratorTaskCreateWorkItemToStage } from '../../../../../src/api/routes/orchestrator-control/stage-alignment.js';
import { normalizeOrchestratorTaskCreateInput } from '../../../../../src/api/routes/orchestrator-control/task-assessment-linkage.js';
import { logSafetynetTriggered } from '../../../../../src/services/safetynet/logging.js';

describe('orchestrator-control safetynet inferences', () => {
  it('logs when parent_work_item_id is inferred from activation context', async () => {
    const normalized = await normalizeOrchestratorWorkItemCreateInput(
      {
        query: vi.fn(async () => ({
          rowCount: 1,
          rows: [{
            lifecycle: 'planned',
            event_type: 'task.completed',
            payload: { work_item_id: 'parent-item-1' },
          }],
        })),
      } as never,
      'tenant-1',
      {
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        stage_name: 'design',
        work_item_id: null,
      } as never,
      {
        request_id: 'create-work-item-1',
        title: 'Implementation',
        goal: 'Build the change',
        acceptance_criteria: 'It works',
        stage_name: 'implementation',
      } as never,
    );

    expect(normalized.parent_work_item_id).toBe('parent-item-1');
    expect(logSafetynetTriggered).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'platform.orchestrator.parent_work_item_default_inference',
      }),
      'orchestrator create_work_item defaulted parent_work_item_id from activation context',
      expect.objectContaining({
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        parent_work_item_id: 'parent-item-1',
        activation_event_type: 'task.completed',
      }),
    );
  });

  it('logs when task create work_item_id is stage-aligned to a unique child work item', async () => {
    const normalized = await alignOrchestratorTaskCreateWorkItemToStage(
      {
        query: vi
          .fn()
          .mockResolvedValueOnce({
            rowCount: 1,
            rows: [{
              id: 'implementation-item',
              stage_name: 'implementation',
              parent_work_item_id: null,
              parent_id: null,
              parent_stage_name: null,
              workflow_lifecycle: 'planned',
            }],
          })
          .mockResolvedValueOnce({
            rowCount: 1,
            rows: [{ id: 'approval-item' }],
          }),
      } as never,
      'tenant-1',
      'workflow-1',
      {
        request_id: 'create-task-1',
        title: 'Prepare approval packet',
        description: 'Move the work into approval.',
        work_item_id: 'implementation-item',
        stage_name: 'approval',
        role: 'product-manager',
        type: 'docs',
      } as never,
    );

    expect(normalized.work_item_id).toBe('approval-item');
    expect(logSafetynetTriggered).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'platform.orchestrator.stage_alignment_repair',
      }),
      'orchestrator create_task repaired work_item_id to match the requested stage',
      expect.objectContaining({
        workflow_id: 'workflow-1',
        requested_work_item_id: 'implementation-item',
        aligned_work_item_id: 'approval-item',
        alignment_source: 'child_stage_match',
        target_stage_name: 'approval',
      }),
    );
  });

  it('logs when task type is inferred from the work-item expectation', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            id: 'implementation-item',
            stage_name: 'implementation',
            parent_work_item_id: null,
            parent_id: null,
            parent_stage_name: null,
            workflow_lifecycle: 'planned',
          }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            next_expected_actor: 'delivery-quality-assessor',
            next_expected_action: 'assess',
          }],
        }),
    };

    const normalized = await normalizeOrchestratorTaskCreateInput(
      pool as never,
      'tenant-1',
      {
        workflow_id: 'workflow-1',
        activation_id: null,
        stage_name: 'implementation',
      } as never,
      {
        request_id: 'create-assessment-1',
        title: 'Assess the output',
        description: 'Assess the delivery result.',
        work_item_id: 'implementation-item',
        stage_name: 'implementation',
        role: 'delivery-quality-assessor',
      } as never,
    );

    expect(normalized.type).toBe('assessment');
    expect(logSafetynetTriggered).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'platform.orchestrator.expected_task_type_inference',
      }),
      'orchestrator create_task inferred assessment type from work-item expectation',
      expect.objectContaining({
        workflow_id: 'workflow-1',
        work_item_id: 'implementation-item',
        role: 'delivery-quality-assessor',
        inferred_type: 'assessment',
      }),
    );
  });
});
