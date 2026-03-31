import { randomUUID } from 'node:crypto';

import type { DatabaseClient, DatabasePool } from '../db/database.js';

import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import { parsePlaybookDefinition } from '../orchestration/playbook-model.js';
import type { LogService } from '../logging/log-service.js';
import { ArtifactRetentionService } from './artifact-retention-service.js';
import { EventService } from './event-service.js';
import { WorkspaceTimelineService } from './workspace-timeline-service.js';
import { enqueueWorkflowActivationRecord } from './workflow-activation/workflow-activation-record.js';

export class WorkflowStateService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
    private readonly artifactRetentionService?: ArtifactRetentionService,
    private readonly workspaceTimelineService?: WorkspaceTimelineService,
    private readonly logService?: LogService,
  ) {}

  async recomputeWorkflowState(
    tenantId: string,
    workflowId: string,
    client?: DatabaseClient,
    actor: { actorType: string; actorId?: string } = {
      actorType: 'system',
      actorId: 'workflow_state_deriver',
    },
  ) {
    const db = client ?? this.pool;
    const workflowRes = await db.query(
      `SELECT w.id, w.state, w.started_at, w.completed_at, w.metadata, w.name, w.parameters,
              w.playbook_id
       FROM workflows w
       WHERE w.tenant_id = $1 AND w.id = $2`,
      [tenantId, workflowId],
    );

    if (!workflowRes.rowCount) {
      throw new NotFoundError('Workflow not found');
    }

    const previousState = workflowRes.rows[0].state as string;
    const playbookId = (workflowRes.rows[0] as Record<string, unknown>).playbook_id as string | null;
    if (!playbookId) {
      throw new ConflictError('Workflow state recomputation is only supported for playbook workflows');
    }
    const workflowMetadata = asRecord(workflowRes.rows[0].metadata);
    let derivedState: string;
    if (workflowMetadata.cancel_requested_at) {
      derivedState = await this.deriveCancellationState(tenantId, workflowId, db);
    } else if (hasWorkflowPauseMarker(workflowMetadata)) {
      derivedState = 'paused';
    } else {
      derivedState = await this.derivePlaybookWorkflowState(tenantId, workflowId, previousState, db);
    }

    const setStartedAt = derivedState === 'active';
    const setCompletedAt = ['completed', 'failed', 'cancelled'].includes(derivedState);
    const clearCompletedAt =
      !setCompletedAt && previousState === 'completed' && workflowRes.rows[0].completed_at != null;

    await db.query(
      `UPDATE workflows
       SET state = $3,
           started_at = CASE WHEN $4 AND started_at IS NULL THEN now() ELSE started_at END,
           completed_at = CASE
             WHEN $5 THEN COALESCE(completed_at, now())
             WHEN $6 THEN NULL
             ELSE completed_at
           END,
           updated_at = now()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, workflowId, derivedState, setStartedAt, setCompletedAt, clearCompletedAt],
    );

    if (
      previousState !== derivedState &&
      ['completed', 'failed', 'cancelled'].includes(derivedState)
    ) {
      await this.artifactRetentionService?.purgeWorkflowArtifactsOnTerminalState(tenantId, workflowId, client);
      await this.workspaceTimelineService?.recordWorkflowTerminalState(tenantId, workflowId, client);
    }

    if (previousState !== derivedState) {
      const lifecycleActor = deriveWorkflowLifecycleActor(actor);
      await this.eventService.emit(
        {
          tenantId,
          type: 'workflow.state_changed',
          entityType: 'workflow',
          entityId: workflowId,
          actorType: actor.actorType,
          actorId: actor.actorId ?? null,
          data: {
            from_state: previousState,
            to_state: derivedState,
            ...(lifecycleActor.role ? { role: lifecycleActor.role } : {}),
            ...(lifecycleActor.isOrchestratorTask
              ? { is_orchestrator_task: lifecycleActor.isOrchestratorTask }
              : {}),
          },
        },
        client,
      );

      const workflowRow = workflowRes.rows[0];
      const isTerminal = ['completed', 'failed', 'cancelled'].includes(derivedState);
      const terminalTaskCounts = isTerminal ? await this.loadTerminalTaskCounts(db, tenantId, workflowId) : null;

      if (isTerminal) {
        await this.enqueueParentWorkflowOutcome(db, tenantId, workflowId, workflowMetadata, {
          workflowName: workflowRow.name as string,
          playbookId,
          state: derivedState,
          taskCount: terminalTaskCounts?.taskCount ?? 0,
          failedTaskCount: terminalTaskCounts?.failedTaskCount ?? 0,
        });
      }

      void this.logService?.insert({
        tenantId,
        traceId: randomUUID(),
        spanId: randomUUID(),
        source: 'platform',
        category: 'task_lifecycle',
        level: derivedState === 'failed' ? 'error' : 'info',
        operation: `task_lifecycle.workflow.state_changed`,
        status: isTerminal ? 'completed' : 'started',
        payload: {
          from_state: previousState,
          to_state: derivedState,
          workflow_name: workflowRow.name as string,
          playbook_id:
            ((workflowRow as Record<string, unknown>).playbook_id as string | null) ?? undefined,
          parameters: asRecord(workflowRow.parameters),
          task_count: terminalTaskCounts?.taskCount,
          failed_task_count: terminalTaskCounts?.failedTaskCount,
        },
        workflowId,
        workflowName: workflowRow.name as string,
        actorType: actor.actorType,
        actorId: actor.actorId,
        role: lifecycleActor.role,
        isOrchestratorTask: lifecycleActor.isOrchestratorTask,
        resourceType: 'workflow',
        resourceId: workflowId,
        resourceName: workflowRow.name as string,
      }).catch(() => undefined);
    }

    return derivedState;
  }

  private async deriveCancellationState(
    tenantId: string,
    workflowId: string,
    db: DatabaseClient | DatabasePool,
  ) {
    void tenantId;
    void workflowId;
    void db;
    return 'cancelled';
  }

  private async enqueueParentWorkflowOutcome(
    db: DatabaseClient | DatabasePool,
    tenantId: string,
    workflowId: string,
    workflowMetadata: Record<string, unknown>,
    outcome: {
      workflowName: string;
      playbookId: string;
      state: string;
      taskCount: number;
      failedTaskCount: number;
    },
  ) {
    const parentWorkflowId = readOptionalString(workflowMetadata.parent_workflow_id);
    if (!parentWorkflowId) return;

    await enqueueWorkflowActivationRecord(db, this.eventService, {
      tenantId,
      workflowId: parentWorkflowId,
      requestId: `child-workflow:${workflowId}:${outcome.state}`,
      reason: `child_workflow.${outcome.state}`,
      eventType: `child_workflow.${outcome.state}`,
      payload: {
        child_workflow_id: workflowId,
        child_workflow_name: outcome.workflowName,
        child_workflow_state: outcome.state,
        child_playbook_id: outcome.playbookId,
        parent_workflow_id: parentWorkflowId,
        parent_orchestrator_task_id: readOptionalString(workflowMetadata.parent_orchestrator_task_id),
        parent_orchestrator_activation_id: readOptionalString(
          workflowMetadata.parent_orchestrator_activation_id,
        ),
        parent_work_item_id: readOptionalString(workflowMetadata.parent_work_item_id),
        parent_stage_name: readOptionalString(workflowMetadata.parent_stage_name),
        outcome: {
          state: outcome.state,
          task_count: outcome.taskCount,
          failed_task_count: outcome.failedTaskCount,
        },
      },
      actorType: 'system',
      actorId: 'workflow_state_deriver',
    });
  }

  private async derivePlaybookWorkflowState(
    tenantId: string,
    workflowId: string,
    previousState: string,
    db: DatabaseClient | DatabasePool,
  ) {
    if (previousState === 'failed' || previousState === 'cancelled') {
      return previousState;
    }

    const posture = await this.loadWorkflowPosture(tenantId, workflowId, db);
    if (posture.lifecycle === 'ongoing') {
      return deriveContinuousWorkflowState(posture);
    }

    if (hasCompletedPlannedWorkflow(posture)) {
      return 'completed';
    }

    const stageStatuses = posture.stages.map((row) => row.status);
    if (stageStatuses.length > 0 && stageStatuses.every((status) => status === 'completed')) {
      return 'completed';
    }
    return hasActiveWorkflowPosture(posture) ? 'active' : 'pending';
  }

  private async loadWorkflowPosture(
    tenantId: string,
    workflowId: string,
    db: DatabaseClient | DatabasePool,
  ): Promise<WorkflowPosture> {
    const workflowResult = await db.query<{ lifecycle: string | null; definition?: unknown }>(
      `SELECT w.lifecycle, p.definition
         FROM workflows w
         LEFT JOIN playbooks p
           ON p.tenant_id = w.tenant_id
          AND p.id = w.playbook_id
        WHERE w.tenant_id = $1
          AND w.id = $2`,
      [tenantId, workflowId],
    );

    const normalizedLifecycle: WorkflowPosture['lifecycle'] =
      workflowResult.rows[0]?.lifecycle === 'ongoing' ? 'ongoing' : 'planned';
    const terminalColumnIds = readTerminalColumnIds(workflowResult.rows[0]?.definition);
    const loadWorkItemCounts = () =>
      normalizedLifecycle === 'ongoing'
        ? db.query<{ total_work_item_count: number; open_work_item_count: number }>(
          `SELECT COUNT(*)::int AS total_work_item_count,
                  COUNT(*) FILTER (
                    WHERE completed_at IS NULL
                      AND COALESCE(column_id = ANY($3::text[]), FALSE) = FALSE
                  )::int AS open_work_item_count
             FROM workflow_work_items
            WHERE tenant_id = $1
              AND workflow_id = $2`,
          [tenantId, workflowId, terminalColumnIds],
        )
        : db.query<{ total_work_item_count: number; open_work_item_count: number }>(
          `SELECT COUNT(*)::int AS total_work_item_count,
                  COUNT(*) FILTER (WHERE completed_at IS NULL)::int AS open_work_item_count
             FROM workflow_work_items
            WHERE tenant_id = $1
              AND workflow_id = $2`,
          [tenantId, workflowId],
        );
    const [stageResult, orchestratorResult, workItemResult] = await Promise.all([
      db.query<{ status: string; gate_status: string }>(
        'SELECT status, gate_status FROM workflow_stages WHERE tenant_id = $1 AND workflow_id = $2',
        [tenantId, workflowId],
      ),
      db.query(
        `SELECT 1
           FROM tasks
          WHERE tenant_id = $1
            AND workflow_id = $2
            AND is_orchestrator_task = true
            AND state IN ('ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment')
          LIMIT 1`,
        [tenantId, workflowId],
      ),
      loadWorkItemCounts(),
    ]);

    return buildWorkflowPosture(
      normalizedLifecycle,
      stageResult.rows,
      (orchestratorResult.rowCount ?? 0) > 0,
      workItemResult.rows[0]?.total_work_item_count ?? 0,
      workItemResult.rows[0]?.open_work_item_count ?? 0,
    );
  }

  private async loadTerminalTaskCounts(db: DatabaseClient | DatabasePool, tenantId: string, workflowId: string) {
    const result = await db.query<{ task_count: number; failed_task_count: number }>(
      `SELECT COUNT(*)::int AS task_count,
              COUNT(*) FILTER (WHERE state = 'failed')::int AS failed_task_count FROM tasks
        WHERE tenant_id = $1 AND workflow_id = $2`,
      [tenantId, workflowId],
    );
    return { taskCount: result.rows[0]?.task_count ?? 0, failedTaskCount: result.rows[0]?.failed_task_count ?? 0 };
  }
}

function deriveWorkflowLifecycleActor(actor: { actorType: string; actorId?: string }) {
  if (actor.actorType === 'agent' || actor.actorType === 'worker') {
    return {
      role: 'orchestrator',
      isOrchestratorTask: true,
    };
  }
  return {
    role: null,
    isOrchestratorTask: false,
  };
}

export interface WorkflowPostureBase {
  lifecycle: string;
  stages: Array<{ status: string; gate_status: string }>;
  hasActiveOrchestratorTask: boolean;
  totalWorkItemCount: number;
  openWorkItemCount: number;
}

type WorkflowPostureShape = Omit<WorkflowPostureBase, 'lifecycle'>;

export interface StandardWorkflowPosture extends WorkflowPostureBase {
  lifecycle: 'planned';
}

export interface ContinuousWorkflowPosture extends WorkflowPostureBase {
  lifecycle: 'ongoing';
}

export type WorkflowPosture = StandardWorkflowPosture | ContinuousWorkflowPosture;

export function buildWorkflowPosture(
  lifecycle: string,
  stages: Array<{ status: string; gate_status: string }>,
  hasActiveOrchestratorTask: boolean,
  totalWorkItemCount: number,
  openWorkItemCount: number,
): WorkflowPosture {
  const normalizedLifecycle: WorkflowPosture['lifecycle'] =
    lifecycle === 'ongoing' ? 'ongoing' : 'planned';
  const base: WorkflowPostureShape = {
    stages,
    hasActiveOrchestratorTask,
    totalWorkItemCount,
    openWorkItemCount,
  };
  if (normalizedLifecycle === 'ongoing') {
    return {
      ...base,
      lifecycle: normalizedLifecycle,
    };
  }
  return {
    ...base,
    lifecycle: normalizedLifecycle,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readTerminalColumnIds(definition: unknown): string[] {
  try {
    return parsePlaybookDefinition(definition).board.columns
      .filter((column) => Boolean(column.is_terminal))
      .map((column) => column.id);
  } catch {
    return [];
  }
}

function deriveContinuousWorkflowState(posture: ContinuousWorkflowPosture) {
  return hasContinuousWorkflowPosture(posture) ? 'active' : 'pending';
}

function hasCompletedPlannedWorkflow(posture: StandardWorkflowPosture) {
  return posture.totalWorkItemCount > 0
    && posture.openWorkItemCount === 0
    && !posture.hasActiveOrchestratorTask;
}

function hasActiveWorkflowPosture(posture: StandardWorkflowPosture) {
  if (posture.hasActiveOrchestratorTask || posture.openWorkItemCount > 0) return true;
  if (posture.stages.some((stage) => isAttentionGateStatus(stage.gate_status))) return true;
  return posture.stages.some((stage) => isActiveStageStatus(stage.status));
}

function hasContinuousWorkflowPosture(posture: ContinuousWorkflowPosture) {
  if (posture.hasActiveOrchestratorTask || posture.openWorkItemCount > 0) return true;
  if (posture.stages.some((stage) => isAttentionGateStatus(stage.gate_status))) return true;
  return false;
}

function hasWorkflowPauseMarker(metadata: Record<string, unknown>) {
  return readOptionalString(metadata.pause_requested_at) !== null;
}

export function isTerminalWorkflowState(state: string) {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

export function isAttentionGateStatus(status: string) {
  return status === 'awaiting_approval' || status === 'rejected' || status === 'changes_requested';
}

function isActiveStageStatus(status: string) {
  return status === 'active' || status === 'awaiting_gate' || status === 'blocked';
}
