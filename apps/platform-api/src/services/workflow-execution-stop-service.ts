import type { DatabaseQueryable } from '../db/database.js';
import type { EventService } from './event/event-service.js';
import type { WorkerConnectionHub } from './workers/worker-connection-hub.js';

const CANCELLABLE_WORKFLOW_TASK_STATES = [
  'pending',
  'ready',
  'claimed',
  'in_progress',
  'awaiting_approval',
  'output_pending_assessment',
  'failed',
  'escalated',
] as const;

const ACTIVE_WORKFLOW_TASK_STATES = ['claimed', 'in_progress'] as const;

interface ActiveWorkflowTaskRow {
  id: string;
  state: string;
  assigned_worker_id: string | null;
  is_orchestrator_task: boolean;
}

interface CancelledWorkflowTaskRow {
  id: string;
  is_orchestrator_task: boolean;
  work_item_id: string | null;
}

interface WorkerSignalRow {
  id: string;
  created_at: Date;
}

export interface StopWorkflowBoundExecutionInput {
  tenantId: string;
  workflowId: string;
  workItemId?: string;
  summary: string;
  signalReason: string;
  disposition: 'pause' | 'cancel';
  actorType: string;
  actorId: string | null;
}

export interface StopWorkflowBoundExecutionDeps {
  eventService: EventService;
  resolveCancelSignalGracePeriodMs?: (tenantId: string) => Promise<number>;
  workerConnectionHub?: WorkerConnectionHub;
}

export interface StopWorkflowBoundExecutionResult {
  cancelledTaskIds: string[];
  cancelledSpecialistTaskIds: string[];
  activeTaskIds: string[];
  activeSpecialistTaskIds: string[];
  signalledTaskCount: number;
  cancelledActivationCount: number;
}

export async function stopWorkflowBoundExecution(
  db: DatabaseQueryable,
  deps: StopWorkflowBoundExecutionDeps,
  input: StopWorkflowBoundExecutionInput,
): Promise<StopWorkflowBoundExecutionResult> {
  const activeTasks = await db.query<ActiveWorkflowTaskRow>(
    `SELECT id, state, assigned_worker_id, is_orchestrator_task
      FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND ($4::uuid IS NULL OR work_item_id = $4::uuid)
        AND state = ANY($3::task_state[])
      FOR UPDATE`,
    [input.tenantId, input.workflowId, [...ACTIVE_WORKFLOW_TASK_STATES], input.workItemId ?? null],
  );

  const gracePeriodMs = deps.resolveCancelSignalGracePeriodMs
    ? await deps.resolveCancelSignalGracePeriodMs(input.tenantId)
    : null;
  const signalRequestedAt = gracePeriodMs !== null ? new Date() : null;
  let signalledTaskCount = 0;

  if (input.disposition === 'pause' && signalRequestedAt && gracePeriodMs !== null) {
    for (const task of activeTasks.rows) {
      if (task.state !== 'in_progress') {
        continue;
      }
      if (typeof task.assigned_worker_id !== 'string' || task.assigned_worker_id.trim().length === 0) {
        continue;
      }
      const signalPayload = {
        reason: input.signalReason,
        requested_at: signalRequestedAt.toISOString(),
        grace_period_ms: gracePeriodMs,
      };
      const signalResult = await db.query<{ id: string; created_at: Date }>(
        `INSERT INTO worker_signals (tenant_id, worker_id, signal_type, task_id, data)
         VALUES ($1, $2, 'cancel_task', $3, $4)
         RETURNING id, created_at`,
        [input.tenantId, task.assigned_worker_id, task.id, signalPayload],
      );
      const signal = signalResult.rows[0];
      deps.workerConnectionHub?.sendToWorker(task.assigned_worker_id, {
        type: 'worker.signal',
        signal_id: signal.id,
        signal_type: 'cancel_task',
        task_id: task.id,
        data: signalPayload,
        issued_at: signal.created_at,
      });
      await deps.eventService.emit(
        {
          tenantId: input.tenantId,
          type: 'worker.signaled',
          entityType: 'worker',
          entityId: task.assigned_worker_id,
          actorType: input.actorType,
          actorId: input.actorId,
          data: { signal_type: 'cancel_task', task_id: task.id },
        },
        db,
      );
      signalledTaskCount += 1;
    }
  }

  await queueDrainSignalsForSpecialistWorkers(
    db,
    deps,
    input,
    activeTasks.rows,
  );

  const cancelledTasks = await db.query<CancelledWorkflowTaskRow>(
    `UPDATE tasks
        SET state = 'cancelled',
            state_changed_at = now(),
            completed_at = NULL,
            assigned_agent_id = NULL,
            assigned_worker_id = NULL,
            claimed_at = NULL,
            started_at = NULL,
            metadata = (COALESCE(metadata, '{}'::jsonb)
              - 'cancel_signal_requested_at'
              - 'cancel_force_fail_at'
              - 'cancel_signal_id'
              - 'cancel_reason'
              - 'timeout_cancel_requested_at'
              - 'timeout_force_fail_at'
              - 'timeout_signal_id'
              - 'workflow_cancel_requested_at'
              - 'workflow_cancel_force_at'
              - 'workflow_cancel_signal_id')
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND ($4::uuid IS NULL OR work_item_id = $4::uuid)
        AND state = ANY($3::task_state[])
    RETURNING id, is_orchestrator_task, work_item_id`,
    [input.tenantId, input.workflowId, [...CANCELLABLE_WORKFLOW_TASK_STATES], input.workItemId ?? null],
  );

  const cancelledTaskIds = cancelledTasks.rows.map((row) => row.id);
  const cancelledSpecialistTaskIds = cancelledTasks.rows
    .filter((row) => row.is_orchestrator_task !== true)
    .map((row) => row.id);
  const activeTaskIds = activeTasks.rows.map((row) => row.id);
  const activeSpecialistTaskIds = activeTasks.rows
    .filter((row) => row.is_orchestrator_task !== true)
    .map((row) => row.id);

  if (cancelledTaskIds.length > 0) {
    await db.query(
      `UPDATE agents
          SET current_task_id = NULL,
              status = (CASE WHEN status = 'inactive' THEN 'inactive' ELSE 'idle' END)::agent_status
        WHERE tenant_id = $1
          AND current_task_id = ANY($2::uuid[])`,
      [input.tenantId, cancelledTaskIds],
    );
  }

  if (input.workItemId) {
    await db.query(
      `UPDATE execution_container_leases
          SET released_at = NOW(),
              released_reason = COALESCE(released_reason, 'workflow_stopped')
        WHERE tenant_id = $1
          AND task_id = ANY($2::uuid[])
          AND released_at IS NULL`,
      [input.tenantId, cancelledTaskIds],
    );
  } else {
    await db.query(
      `UPDATE execution_container_leases
          SET released_at = NOW(),
              released_reason = COALESCE(released_reason, 'workflow_stopped')
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND released_at IS NULL`,
      [input.tenantId, input.workflowId],
    );
  }

  if (activeSpecialistTaskIds.length > 0) {
    await db.query(
      `UPDATE runtime_heartbeats
          SET drain_requested = true
        WHERE tenant_id = $1
          AND task_id = ANY($2::uuid[])`,
      [input.tenantId, activeSpecialistTaskIds],
    );
  }

  const cancelledActivations = input.workItemId
    ? { rowCount: 0 }
    : await db.query(
      `UPDATE workflow_activations
          SET state = 'failed',
              consumed_at = COALESCE(consumed_at, now()),
              completed_at = COALESCE(completed_at, now()),
              summary = COALESCE(summary, $3),
              error = COALESCE(error, '{}'::jsonb) || jsonb_build_object('message', $3)
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND state IN ('queued', 'processing')
      RETURNING id`,
      [input.tenantId, input.workflowId, input.summary],
    );

  return {
    cancelledTaskIds,
    cancelledSpecialistTaskIds,
    activeTaskIds,
    activeSpecialistTaskIds,
    signalledTaskCount,
    cancelledActivationCount: cancelledActivations.rowCount ?? 0,
  };
}

async function queueDrainSignalsForSpecialistWorkers(
  db: DatabaseQueryable,
  deps: StopWorkflowBoundExecutionDeps,
  input: StopWorkflowBoundExecutionInput,
  activeTasks: ActiveWorkflowTaskRow[],
): Promise<void> {
  const workerIds = uniqueSpecialistWorkerIds(activeTasks);
  for (const workerId of workerIds) {
    const signalPayload: Record<string, string | null> = {
      reason: 'workflow_stopped',
      workflow_id: input.workflowId,
    };
    if (input.workItemId) {
      signalPayload.work_item_id = input.workItemId;
    }
    const signalResult = await db.query<WorkerSignalRow>(
      `INSERT INTO worker_signals (tenant_id, worker_id, signal_type, task_id, data)
       VALUES ($1, $2, 'set_draining', NULL, $3)
       RETURNING id, created_at`,
      [input.tenantId, workerId, signalPayload],
    );
    const signal = signalResult.rows[0];
    deps.workerConnectionHub?.sendToWorker(workerId, {
      type: 'worker.signal',
      signal_id: signal.id,
      signal_type: 'set_draining',
      task_id: null,
      data: signalPayload,
      issued_at: signal.created_at,
    });
    await deps.eventService.emit(
      {
        tenantId: input.tenantId,
        type: 'worker.signaled',
        entityType: 'worker',
        entityId: workerId,
        actorType: input.actorType,
        actorId: input.actorId,
        data: { signal_type: 'set_draining', task_id: null },
      },
      db,
    );
  }
}

function uniqueSpecialistWorkerIds(activeTasks: ActiveWorkflowTaskRow[]): string[] {
  return Array.from(
    new Set(
      activeTasks
        .filter((task) => task.is_orchestrator_task !== true)
        .map((task) => task.assigned_worker_id?.trim() ?? '')
        .filter((workerId) => workerId.length > 0),
    ),
  );
}
