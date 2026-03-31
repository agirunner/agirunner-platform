import { describe, expect, it, vi } from 'vitest';

import { deriveMissionControlPosture } from '../../src/services/workflow-operations/mission-control-posture.js';
import { MissionControlLiveService } from '../../src/services/workflow-operations/mission-control-live-service.js';

describe('mission control posture', () => {
  it('classifies approval waits as needs_decision ahead of coarse active state', () => {
    const posture = deriveMissionControlPosture({
      workflowState: 'active',
      hasPauseRequest: false,
      hasCancelRequest: false,
      waitingForDecisionCount: 1,
      openEscalationCount: 0,
      blockedWorkItemCount: 0,
      failedTaskCount: 0,
      recoverableIssueCount: 0,
      activeTaskCount: 0,
      activeWorkItemCount: 0,
      pendingWorkItemCount: 1,
      recentOutputCount: 0,
      waitingReason: 'Waiting on approval for release gate',
    });

    expect(posture).toEqual(
      expect.objectContaining({
        posture: 'needs_decision',
        attentionLane: 'needs_decision',
        pulse: expect.objectContaining({
          summary: 'Waiting on approval for release gate',
          tone: 'waiting',
        }),
      }),
    );
  });

  it('classifies failed but recoverable runs as recoverable_needs_steering', () => {
    const posture = deriveMissionControlPosture({
      workflowState: 'failed',
      hasPauseRequest: false,
      hasCancelRequest: false,
      waitingForDecisionCount: 0,
      openEscalationCount: 0,
      blockedWorkItemCount: 1,
      failedTaskCount: 1,
      recoverableIssueCount: 1,
      activeTaskCount: 0,
      activeWorkItemCount: 0,
      pendingWorkItemCount: 0,
      recentOutputCount: 0,
      blockerReason: 'Verification failed twice but the operator can steer a replan',
    });

    expect(posture).toEqual(
      expect.objectContaining({
        posture: 'recoverable_needs_steering',
        attentionLane: 'needs_intervention',
        pulse: expect.objectContaining({
          summary: 'Verification failed twice but the operator can steer a replan',
          tone: 'critical',
        }),
      }),
    );
  });

  it('classifies idle queued workflows as waiting_by_design', () => {
    const posture = deriveMissionControlPosture({
      workflowState: 'pending',
      hasPauseRequest: false,
      hasCancelRequest: false,
      waitingForDecisionCount: 0,
      openEscalationCount: 0,
      blockedWorkItemCount: 0,
      failedTaskCount: 0,
      recoverableIssueCount: 0,
      activeTaskCount: 0,
      activeWorkItemCount: 0,
      pendingWorkItemCount: 2,
      recentOutputCount: 0,
    });

    expect(posture).toEqual(
      expect.objectContaining({
        posture: 'waiting_by_design',
        attentionLane: 'watchlist',
        pulse: expect.objectContaining({
          summary: 'Workflow is queued for the next workflow event',
          tone: 'waiting',
        }),
      }),
    );
  });

  it('avoids the vague waiting-by-design summary when no concrete waiting reason exists', () => {
    const posture = deriveMissionControlPosture({
      workflowState: 'pending',
      hasPauseRequest: false,
      hasCancelRequest: false,
      waitingForDecisionCount: 0,
      openEscalationCount: 0,
      blockedWorkItemCount: 0,
      failedTaskCount: 0,
      recoverableIssueCount: 0,
      activeTaskCount: 0,
      activeWorkItemCount: 0,
      pendingWorkItemCount: 0,
      recentOutputCount: 0,
    });

    expect(posture.pulse.summary).toBe('No work is running right now');
  });

  it('classifies cancellation-in-progress separately from a true paused workflow', () => {
    const posture = deriveMissionControlPosture({
      workflowState: 'paused',
      hasPauseRequest: false,
      hasCancelRequest: true,
      waitingForDecisionCount: 0,
      openEscalationCount: 0,
      blockedWorkItemCount: 0,
      failedTaskCount: 0,
      recoverableIssueCount: 0,
      activeTaskCount: 0,
      activeWorkItemCount: 1,
      pendingWorkItemCount: 0,
      recentOutputCount: 0,
    });

    expect(posture).toEqual(
      expect.objectContaining({
        posture: 'cancelling',
        attentionLane: 'watchlist',
        pulse: expect.objectContaining({
          summary: 'Workflow cancellation is in progress',
          tone: 'waiting',
        }),
      }),
    );
  });
});

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

function createSequencedPool(responses: Array<{ rows: unknown[]; rowCount: number }>) {
  return {
    query: vi.fn(async () => responses.shift() ?? { rows: [], rowCount: 0 }),
  };
}
