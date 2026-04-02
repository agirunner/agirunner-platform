import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import { ValidationError } from '../../errors/domain-errors.js';
import { parsePlaybookDefinition } from '../../orchestration/playbook-model.js';
import { nextStageNameFor } from '../playbook-workflow-control/playbook-workflow-control-utils.js';
import { logSafetynetTriggered } from '../safetynet/logging.js';
import {
  PLATFORM_HANDOFF_ORCHESTRATOR_PROGRESS_GUIDANCE_ID,
  mustGetSafetynetEntry,
} from '../safetynet/registry.js';
import type { TaskContextRow } from './handoff-service.types.js';

const ORCHESTRATOR_PROGRESS_GUIDANCE_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_HANDOFF_ORCHESTRATOR_PROGRESS_GUIDANCE_ID,
);

interface WorkItemRow {
  id: string;
  stage_name: string | null;
  completed_at: Date | null;
  created_at: Date;
}

interface TaskRow {
  id: string;
  role: string | null;
  state: string | null;
  work_item_id: string | null;
  is_orchestrator_task: boolean;
}

interface StageGateRow {
  stage_name: string | null;
  status: string | null;
  closure_effect: string | null;
  requested_by_work_item_id: string | null;
}

interface EscalationRow {
  work_item_id: string | null;
  status: string | null;
  closure_effect: string | null;
}

interface WorkflowDefinitionRow {
  definition: unknown;
}

export async function assertOrchestratorProgressBeforeHandoff(
  tenantId: string,
  task: TaskContextRow,
  db: DatabaseClient | DatabasePool,
): Promise<void> {
  if (!task.is_orchestrator_task || !task.workflow_id) {
    return;
  }

  const [workItemsRes, tasksRes, stageGatesRes, escalationsRes, workflowRes] = await Promise.all([
    db.query<WorkItemRow>(
      `SELECT id, stage_name, completed_at, created_at
         FROM workflow_work_items
        WHERE tenant_id = $1
          AND workflow_id = $2
        ORDER BY created_at DESC`,
      [tenantId, task.workflow_id],
    ),
    db.query<TaskRow>(
      `SELECT id, role, state, work_item_id, is_orchestrator_task
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
        ORDER BY created_at DESC
        LIMIT 200`,
      [tenantId, task.workflow_id],
    ),
    db.query<StageGateRow>(
      `SELECT stage_name, status, closure_effect, requested_by_work_item_id
         FROM workflow_stage_gates
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND status = 'awaiting_approval'`,
      [tenantId, task.workflow_id],
    ),
    db.query<EscalationRow>(
      `SELECT work_item_id, status, closure_effect
         FROM workflow_subject_escalations
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND status = 'open'`,
      [tenantId, task.workflow_id],
    ),
    db.query<WorkflowDefinitionRow>(
      `SELECT p.definition
         FROM workflows w
         JOIN playbooks p
           ON p.tenant_id = w.tenant_id
          AND p.id = w.playbook_id
        WHERE w.tenant_id = $1
          AND w.id = $2
        LIMIT 1`,
      [tenantId, task.workflow_id],
    ),
  ]);

  const workItems = workItemsRes.rows;
  const specialistTasks = tasksRes.rows.filter((row) => row.is_orchestrator_task !== true);
  const workflowDefinition = workflowRes.rows[0]?.definition
    ? parsePlaybookDefinition(workflowRes.rows[0].definition)
    : null;
  const workflowIsPlanned = workflowDefinition?.lifecycle === 'planned';
  const focusWorkItem = selectProgressFocusWorkItem({
    workItems,
    specialistTasks,
    taskWorkItemId: task.work_item_id,
    taskStageName: task.stage_name,
    workflowDefinition,
  });
  const focusWorkItemId = focusWorkItem?.id ?? null;
  const focusStageName = focusWorkItem?.stage_name ?? task.stage_name ?? null;
  const nextStageName = focusStageName && workflowDefinition
    ? nextStageNameFor(workflowDefinition, focusStageName)
    : null;

  const focusedOpenSpecialistTasks = focusWorkItemId
    ? specialistTasks.filter(
        (row) => row.work_item_id === focusWorkItemId && isOpenSpecialistTask(row.state),
      )
    : [];
  const openSpecialistTaskCount = specialistTasks.filter((row) => isOpenSpecialistTask(row.state)).length;
  const activeBlockingControls = countActiveControls({
    focusStageName,
    focusWorkItemId,
    stageGates: stageGatesRes.rows,
    escalations: escalationsRes.rows,
    closureEffect: 'blocking',
  });
  const activeAdvisoryControls = countActiveControls({
    focusStageName,
    focusWorkItemId,
    stageGates: stageGatesRes.rows,
    escalations: escalationsRes.rows,
    closureEffect: 'advisory',
  });
  const openWorkItems = workItems.filter((row) => row.completed_at == null);
  const openFocusedStageWorkItems = focusStageName
    ? workItems.filter((row) => row.stage_name === focusStageName && row.completed_at == null)
    : [];
  const openSuccessorStageWorkItems = nextStageName
    ? workItems.filter((row) => row.stage_name === nextStageName && row.completed_at == null)
    : [];
  const workItemCanCloseNow = Boolean(
    focusWorkItemId
      && focusWorkItem?.completed_at == null
      && focusedOpenSpecialistTasks.length === 0
      && activeBlockingControls === 0,
  );
  const closeThenSuccessorStageCanStartNow = Boolean(
    workItemCanCloseNow
      && nextStageName
      && openFocusedStageWorkItems.length === 1
      && openFocusedStageWorkItems[0]?.id === focusWorkItemId
      && openSuccessorStageWorkItems.length === 0,
  );
  const nextStageCanStartNow = Boolean(
    nextStageName
      && openFocusedStageWorkItems.length === 0
      && openSuccessorStageWorkItems.length === 0
      && openSpecialistTaskCount === 0
      && activeBlockingControls === 0,
  );
  const workflowCanCloseNow = workflowIsPlanned
    && openWorkItems.length === 0
    && openSpecialistTaskCount === 0
    && countWorkflowBlockingControls(stageGatesRes.rows, escalationsRes.rows) === 0
    && !nextStageName;

  if (openSpecialistTaskCount > 0) {
    return;
  }

  if (!workItemCanCloseNow && !closeThenSuccessorStageCanStartNow && !nextStageCanStartNow && !workflowCanCloseNow) {
    return;
  }

  const closureReadiness = activeBlockingControls > 0
    ? 'blocked'
    : activeAdvisoryControls > 0
      ? 'can_close_with_callouts'
      : 'ready_to_close';
  const targetType = workflowCanCloseNow || closeThenSuccessorStageCanStartNow || nextStageCanStartNow
    ? 'workflow'
    : 'work_item';
  const targetId = workflowCanCloseNow || closeThenSuccessorStageCanStartNow || nextStageCanStartNow
    ? task.workflow_id
    : focusWorkItemId;
  const recoveryAction = workflowCanCloseNow
    ? 'complete_workflow_before_handoff'
    : closeThenSuccessorStageCanStartNow
      ? 'complete_work_item_then_route_successor_stage_before_handoff'
    : nextStageCanStartNow
      ? 'route_successor_stage_before_handoff'
      : 'progress_or_close_work_item_before_handoff';
  const reasonCode = closeThenSuccessorStageCanStartNow
    ? 'orchestrator_close_then_successor_stage_progress_required'
    : nextStageCanStartNow
    ? 'orchestrator_successor_stage_progress_required'
    : 'orchestrator_progress_mutation_required';
  const contextSummary = workflowCanCloseNow
    ? 'The workflow can close now and no specialist work remains active.'
    : closeThenSuccessorStageCanStartNow
      ? `Work item ${focusWorkItemId ?? 'unknown'} in stage ${focusStageName ?? 'unknown'} can close now, and doing so unlocks immediate successor-stage routing for ${nextStageName ?? 'unknown'}.`
    : nextStageCanStartNow
      ? `Stage ${focusStageName ?? 'unknown'} has no active specialist work left and its immediate successor stage ${nextStageName ?? 'unknown'} can start now.`
      : `Work item ${focusWorkItemId ?? 'unknown'} in stage ${focusStageName ?? 'unknown'} has no active specialist tasks and no blocking controls, so the activation must progress it before ending.`;

  logSafetynetTriggered(
    ORCHESTRATOR_PROGRESS_GUIDANCE_SAFETYNET,
    'orchestrator handoff rejected because workflow progress could still be applied in the same activation',
    {
      workflow_id: task.workflow_id,
      work_item_id: focusWorkItemId,
      task_id: task.id,
      stage_name: focusStageName,
      reason_code: reasonCode,
      workflow_can_close_now: workflowCanCloseNow,
      work_item_can_close_now: workItemCanCloseNow,
      close_then_successor_stage_can_start_now: closeThenSuccessorStageCanStartNow,
      next_stage_can_start_now: nextStageCanStartNow,
      next_stage_name: nextStageName,
      closure_readiness: closureReadiness,
      open_specialist_task_count: openSpecialistTaskCount,
    },
  );

  throw new ValidationError(
    workflowCanCloseNow
      ? 'Workflow can close now. Perform the explicit workflow-closing mutation before submit_handoff.'
      : closeThenSuccessorStageCanStartNow
        ? 'Focused work can close now and its immediate successor stage can start after closure. Complete the work item, route the successor stage, then submit_handoff.'
      : nextStageCanStartNow
        ? 'Successor stage can start now. Route it before submit_handoff.'
      : 'Focused work can still progress now. Perform the required workflow mutation before submit_handoff.',
    {
      reason_code: reasonCode,
      recoverable: true,
      recovery_hint: recoveryAction,
      safetynet_behavior_id: ORCHESTRATOR_PROGRESS_GUIDANCE_SAFETYNET.id,
      recovery: {
        status: 'action_required',
        reason: reasonCode,
        action: recoveryAction,
        target_type: targetType,
        target_id: targetId,
      },
      context_summary: contextSummary,
      closure_context: {
        workflow_can_close_now: workflowCanCloseNow,
        work_item_can_close_now: workItemCanCloseNow,
        close_then_successor_stage_can_start_now: closeThenSuccessorStageCanStartNow,
        next_stage_can_start_now: nextStageCanStartNow,
        next_stage_name: nextStageName,
        closure_readiness: closureReadiness,
        active_blocking_control_count: activeBlockingControls,
        active_advisory_control_count: activeAdvisoryControls,
        open_specialist_task_count: openSpecialistTaskCount,
        stage_name: focusStageName,
        work_item_id: focusWorkItemId,
      },
      suggested_next_actions: workflowCanCloseNow
        ? [
            {
              action_code: 'complete_workflow_or_close_with_callouts',
              target_type: 'workflow',
              target_id: task.workflow_id,
              why: 'No specialist work remains active and the workflow can close now.',
              requires_orchestrator_judgment: true,
            },
          ]
        : closeThenSuccessorStageCanStartNow
          ? [
              {
                action_code: 'complete_current_work_item',
                target_type: 'work_item',
                target_id: focusWorkItemId,
                why: 'The current work item can close now, and leaving it open blocks immediate successor-stage routing.',
                requires_orchestrator_judgment: true,
              },
              {
                action_code: 'inspect_successor_stage_contract',
                target_type: 'workflow',
                target_id: task.workflow_id,
                why: `Closing the current work item unlocks the immediate successor stage '${nextStageName ?? 'unknown'}'.`,
                requires_orchestrator_judgment: false,
              },
              {
                action_code: 'route_successor_stage_work',
                target_type: 'workflow',
                target_id: task.workflow_id,
                why: `Create successor work in '${nextStageName ?? 'unknown'}' after closing the current work item and before ending this activation.`,
                requires_orchestrator_judgment: true,
              },
            ]
        : nextStageCanStartNow
          ? [
              {
                action_code: 'inspect_successor_stage_contract',
                target_type: 'workflow',
                target_id: task.workflow_id,
                why: `The immediate successor stage '${nextStageName ?? 'unknown'}' is the next legal planned workflow step.`,
                requires_orchestrator_judgment: false,
              },
              {
                action_code: 'route_successor_stage_work',
                target_type: 'workflow',
                target_id: task.workflow_id,
                why: `Create successor work in '${nextStageName ?? 'unknown'}' before ending this activation.`,
                requires_orchestrator_judgment: true,
              },
            ]
        : [
            {
              action_code: 'inspect_focused_work_item',
              target_type: 'work_item',
              target_id: focusWorkItemId,
              why: 'The focused work item has no active specialist work and can legally progress now.',
              requires_orchestrator_judgment: false,
            },
            {
              action_code: 'complete_or_route_work_item',
              target_type: 'work_item',
              target_id: focusWorkItemId,
              why: activeAdvisoryControls > 0
                ? 'Use explicit closure with callouts or successor routing instead of leaving advisory work parked.'
                : 'Close the accepted work item or route the successor work in this activation instead of ending on a recommendation.',
              requires_orchestrator_judgment: true,
            },
          ],
    },
  );
}

function selectFocusedWorkItem(
  workItems: WorkItemRow[],
  taskWorkItemId: string | null,
  taskStageName: string | null,
): WorkItemRow | null {
  if (taskWorkItemId) {
    const exact = workItems.find((row) => row.id === taskWorkItemId);
    if (exact) {
      return exact;
    }
  }

  if (taskStageName) {
    const stageMatch = workItems.find(
      (row) => row.stage_name === taskStageName && row.completed_at == null,
    );
    if (stageMatch) {
      return stageMatch;
    }
  }

  return workItems.find((row) => row.completed_at == null) ?? workItems[0] ?? null;
}

function selectProgressFocusWorkItem(input: {
  workItems: WorkItemRow[];
  specialistTasks: TaskRow[];
  taskWorkItemId: string | null;
  taskStageName: string | null;
  workflowDefinition: ReturnType<typeof parsePlaybookDefinition> | null;
}): WorkItemRow | null {
  const initialFocus = selectFocusedWorkItem(
    input.workItems,
    input.taskWorkItemId,
    input.taskStageName,
  );
  if (!initialFocus || initialFocus.completed_at == null || !input.workflowDefinition || !initialFocus.stage_name) {
    return initialFocus;
  }

  const immediateSuccessorStageName = nextStageNameFor(input.workflowDefinition, initialFocus.stage_name);
  if (!immediateSuccessorStageName) {
    return initialFocus;
  }

  const openSuccessorStageWorkItems = input.workItems.filter(
    (row) => row.stage_name === immediateSuccessorStageName && row.completed_at == null,
  );
  if (openSuccessorStageWorkItems.length !== 1) {
    return initialFocus;
  }

  const successorFocus = openSuccessorStageWorkItems[0];
  const successorHasSpecialistHistory = input.specialistTasks.some(
    (row) => row.work_item_id === successorFocus.id,
  );
  if (!successorHasSpecialistHistory) {
    return initialFocus;
  }

  return successorFocus;
}

function isOpenSpecialistTask(state: string | null): boolean {
  return state === 'ready'
    || state === 'claimed'
    || state === 'in_progress'
    || state === 'awaiting_approval'
    || state === 'output_pending_assessment';
}

function countActiveControls(input: {
  focusStageName: string | null;
  focusWorkItemId: string | null;
  stageGates: StageGateRow[];
  escalations: EscalationRow[];
  closureEffect: 'blocking' | 'advisory';
}): number {
  const gateCount = input.stageGates
    .filter((row) => normalizeClosureEffect(row.closure_effect) === input.closureEffect)
    .filter((row) => !input.focusStageName || row.stage_name === input.focusStageName)
    .filter(
      (row) =>
        !input.focusWorkItemId
        || !row.requested_by_work_item_id
        || row.requested_by_work_item_id === input.focusWorkItemId,
    ).length;
  const escalationCount = input.escalations
    .filter((row) => normalizeClosureEffect(row.closure_effect) === input.closureEffect)
    .filter(
      (row) =>
        !input.focusWorkItemId
        || !row.work_item_id
        || row.work_item_id === input.focusWorkItemId,
    ).length;
  return gateCount + escalationCount;
}

function countWorkflowBlockingControls(
  stageGates: StageGateRow[],
  escalations: EscalationRow[],
): number {
  return stageGates.filter((row) => normalizeClosureEffect(row.closure_effect) === 'blocking').length
    + escalations.filter((row) => normalizeClosureEffect(row.closure_effect) === 'blocking').length;
}

function normalizeClosureEffect(value: string | null): 'blocking' | 'advisory' | null {
  if (value !== 'blocking' && value !== 'advisory') {
    return null;
  }
  return value;
}
