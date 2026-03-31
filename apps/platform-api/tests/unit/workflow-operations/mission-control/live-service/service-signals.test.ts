import { describe, expect, it } from 'vitest';

import { MissionControlLiveService } from '../../../../../src/services/workflow-operations/mission-control/live-service.js';
import { createSequencedPool } from './test-helpers.js';

describe('MissionControlLiveService signals', () => {
  it('excludes orchestrator tasks from active task counts in workflow signals', async () => {
    const pool = createSequencedPool([
      { rows: [{ latest_event_id: 10 }], rowCount: 1 },
      {
        rows: [
          {
            id: 'workflow-3',
            name: 'Signal Workflow',
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
            workflow_id: 'workflow-3',
            waiting_for_decision_count: 0,
            open_escalation_count: 0,
            blocked_work_item_count: 0,
            failed_task_count: 0,
            active_task_count: 0,
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
    await service.getLive('tenant-1');

    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('AND is_orchestrator_task = FALSE'),
      expect.any(Array),
    );
  });

  it('counts stage-gate waits and blockers in workflow signals', async () => {
    const pool = createSequencedPool([
      { rows: [{ latest_event_id: 42 }], rowCount: 1 },
      {
        rows: [
          {
            id: 'workflow-1',
            name: 'Release Workflow',
            state: 'active',
            lifecycle: 'planned',
            current_stage: 'review',
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
            blocked_work_item_count: 1,
            failed_task_count: 0,
            active_task_count: 0,
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

    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('FROM workflow_stages'),
      expect.any(Array),
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("gate_status = 'awaiting_approval'"),
      expect.any(Array),
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("gate_status IN ('blocked', 'changes_requested', 'rejected')"),
      expect.any(Array),
    );
    expect(response.sections).toEqual([
      expect.objectContaining({
        id: 'needs_action',
        count: 1,
        workflows: [
          expect.objectContaining({
            id: 'workflow-1',
            posture: 'needs_decision',
            metrics: expect.objectContaining({
              waitingForDecisionCount: 1,
              blockedWorkItemCount: 1,
            }),
          }),
        ],
      }),
    ]);
  });

  it('treats request-changes work items as blocked workflow attention in the live card query', async () => {
    const pool = createSequencedPool([
      { rows: [{ latest_event_id: 42 }], rowCount: 1 },
      {
        rows: [
          {
            id: 'workflow-1',
            name: 'Release Workflow',
            state: 'active',
            lifecycle: 'planned',
            current_stage: 'review',
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
            waiting_for_decision_count: 0,
            open_escalation_count: 0,
            blocked_work_item_count: 1,
            failed_task_count: 0,
            active_task_count: 0,
            active_work_item_count: 1,
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

    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("COALESCE(ws.gate_status, 'not_requested') IN ('blocked', 'request_changes', 'changes_requested', 'rejected')"),
      expect.any(Array),
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('LEFT JOIN workflow_stages ws'),
      expect.any(Array),
    );
    expect(response.sections).toEqual([
      expect.objectContaining({
        id: 'at_risk',
        count: 1,
        workflows: [
          expect.objectContaining({
            id: 'workflow-1',
            posture: 'needs_intervention',
            metrics: expect.objectContaining({
              blockedWorkItemCount: 1,
            }),
          }),
        ],
      }),
    ]);
  });

  it('qualifies workflow-work-item signal columns so the live signal query stays valid in joined subqueries', async () => {
    const pool = createSequencedPool([
      { rows: [{ latest_event_id: 42 }], rowCount: 1 },
      {
        rows: [
          {
            id: 'workflow-1',
            name: 'Release Workflow',
            state: 'active',
            lifecycle: 'planned',
            current_stage: 'review',
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
            waiting_for_decision_count: 0,
            open_escalation_count: 0,
            blocked_work_item_count: 0,
            failed_task_count: 0,
            active_task_count: 0,
            active_work_item_count: 1,
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
    await service.getLive('tenant-1');

    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('WHERE wi.tenant_id = $1'),
      expect.any(Array),
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('AND wi.workflow_id = ANY($2::uuid[])'),
      expect.any(Array),
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("data->>'workflow_id' = ANY($3::text[])"),
      expect.any(Array),
    );
  });
});
