import type { DatabaseClient, DatabasePool } from '../db/database.js';
import type {
  WorkflowSummarySnapshot,
  WorkflowSummarySource,
} from './workspace-timeline-summary-support.js';

const WORKFLOW_TIMELINE_EVENT_TYPES = [
  'stage.started',
  'stage.completed',
  'workflow.activation_queued',
  'workflow.activation_started',
  'workflow.activation_completed',
  'workflow.activation_failed',
  'workflow.activation_requeued',
  'workflow.activation_stale_detected',
] as const;
const CHILD_WORKFLOW_TIMELINE_EVENT_TYPES = [
  'child_workflow.completed',
  'child_workflow.failed',
  'child_workflow.cancelled',
] as const;
const GATE_TIMELINE_EVENT_TYPES = [
  'stage.gate_requested',
  'stage.gate.approve',
  'stage.gate.reject',
  'stage.gate.request_changes',
] as const;
const TASK_TIMELINE_EVENT_TYPES = [
  'task.agent_escalated',
  'task.escalation_task_created',
  'task.escalation_response_recorded',
  'task.escalation_resolved',
  'task.escalation_depth_exceeded',
] as const;
const WORK_ITEM_TIMELINE_EVENT_TYPES = ['work_item.created', 'work_item.updated'] as const;

type DatabaseExecutor = DatabaseClient | DatabasePool;

export async function loadWorkflowSummarySnapshots(
  db: DatabaseExecutor,
  tenantId: string,
  workflowIds: string[],
): Promise<Map<string, WorkflowSummarySnapshot>> {
  if (workflowIds.length === 0) {
    return new Map();
  }

  const snapshots = createSnapshotMap(workflowIds);
  const workflowIdTextArray = workflowIds;
  const workflowIdUuidArray = workflowIds;
  const [
    tasksResult,
    artifactsResult,
    eventsResult,
    stagesResult,
    workItemsResult,
    activationsResult,
    gatesResult,
  ] = await Promise.all([
    db.query(
      `SELECT *
           FROM tasks
          WHERE tenant_id = $1
            AND workflow_id = ANY($2::uuid[])
          ORDER BY workflow_id ASC, created_at ASC`,
      [tenantId, workflowIdUuidArray],
    ),
    db.query(
      `SELECT workflow_id, id, task_id, logical_path, content_type, size_bytes, created_at
           FROM workflow_artifacts
          WHERE tenant_id = $1
            AND workflow_id = ANY($2::uuid[])
          ORDER BY workflow_id ASC, created_at ASC`,
      [tenantId, workflowIdUuidArray],
    ),
    db.query(
      `SELECT CASE
                  WHEN e.entity_type = 'workflow' AND e.entity_id::text = ANY($2::text[])
                    THEN e.entity_id::text
                  WHEN e.entity_type = 'workflow' AND COALESCE(e.data->>'parent_workflow_id', '') = ANY($2::text[])
                    THEN COALESCE(e.data->>'parent_workflow_id', '')
                  WHEN e.entity_type = 'gate'
                    THEN COALESCE(e.data->>'workflow_id', '')
                  WHEN e.entity_type = 'task'
                    THEN task_events.workflow_id::text
                  WHEN e.entity_type = 'work_item'
                    THEN COALESCE(e.data->>'workflow_id', '')
                  ELSE NULL
                END AS workflow_id,
                e.type,
                e.actor_type,
                e.actor_id,
                e.data,
                e.created_at
           FROM events e
           LEFT JOIN tasks task_events
             ON e.entity_type = 'task'
            AND task_events.tenant_id = e.tenant_id
            AND task_events.id::text = e.entity_id::text
          WHERE e.tenant_id = $1
            AND (
              (
                e.entity_type = 'workflow'
                AND e.entity_id::text = ANY($2::text[])
                AND e.type = ANY($3::text[])
              )
              OR (
                e.entity_type = 'workflow'
                AND COALESCE(e.data->>'parent_workflow_id', '') = ANY($2::text[])
                AND e.type = ANY($4::text[])
              )
              OR (
                e.entity_type = 'gate'
                AND COALESCE(e.data->>'workflow_id', '') = ANY($2::text[])
                AND e.type = ANY($5::text[])
              )
              OR (
                e.entity_type = 'task'
                AND task_events.workflow_id = ANY($6::uuid[])
                AND e.type = ANY($7::text[])
              )
              OR (
                e.entity_type = 'work_item'
                AND COALESCE(e.data->>'workflow_id', '') = ANY($2::text[])
                AND e.type = ANY($8::text[])
              )
            )
          ORDER BY workflow_id ASC, e.created_at ASC`,
      [
        tenantId,
        workflowIdTextArray,
        [...WORKFLOW_TIMELINE_EVENT_TYPES],
        [...CHILD_WORKFLOW_TIMELINE_EVENT_TYPES],
        [...GATE_TIMELINE_EVENT_TYPES],
        workflowIdUuidArray,
        [...TASK_TIMELINE_EVENT_TYPES],
        [...WORK_ITEM_TIMELINE_EVENT_TYPES],
      ],
    ),
    db.query(
      `SELECT workflow_id, name, goal, human_gate, status, gate_status, iteration_count, summary, started_at, completed_at
           FROM workflow_stages
          WHERE tenant_id = $1
            AND workflow_id = ANY($2::uuid[])
          ORDER BY workflow_id ASC, position ASC`,
      [tenantId, workflowIdUuidArray],
    ),
    db.query(
      `SELECT workflow_id, id, stage_name, column_id, title, completed_at
           FROM workflow_work_items
          WHERE tenant_id = $1
            AND workflow_id = ANY($2::uuid[])
          ORDER BY workflow_id ASC, created_at ASC`,
      [tenantId, workflowIdUuidArray],
    ),
    db.query(
      `SELECT workflow_id,
                activation_id,
                state,
                reason,
                event_type,
                COALESCE(payload->>'task_id', '') AS task_id,
                queued_at,
                started_at,
                consumed_at,
                completed_at,
                error
           FROM workflow_activations
          WHERE tenant_id = $1
            AND workflow_id = ANY($2::uuid[])
            AND activation_id IS NOT NULL
          ORDER BY workflow_id ASC, queued_at ASC`,
      [tenantId, workflowIdUuidArray],
    ),
    db.query(
      `SELECT workflow_id,
                id,
                stage_name,
                status,
                request_summary,
                recommendation,
                concerns,
                key_artifacts,
                requested_by_type,
                requested_by_id,
                requested_at,
                decision_feedback,
                decided_by_type,
                decided_by_id,
                decided_at
           FROM workflow_stage_gates
          WHERE tenant_id = $1
            AND workflow_id = ANY($2::uuid[])
          ORDER BY workflow_id ASC, requested_at ASC`,
      [tenantId, workflowIdUuidArray],
    ),
  ]);

  assignRows(
    snapshots,
    tasksResult.rows as WorkflowSummarySource[],
    readWorkflowIdFromRow,
    'tasks',
  );
  assignRows(
    snapshots,
    artifactsResult.rows as WorkflowSummarySource[],
    readWorkflowIdFromRow,
    'artifacts',
  );
  assignRows(
    snapshots,
    eventsResult.rows as WorkflowSummarySource[],
    readWorkflowIdFromRow,
    'events',
  );
  assignRows(
    snapshots,
    stagesResult.rows as WorkflowSummarySource[],
    readWorkflowIdFromRow,
    'stages',
  );
  assignRows(
    snapshots,
    workItemsResult.rows as WorkflowSummarySource[],
    readWorkflowIdFromRow,
    'workItems',
  );
  assignRows(
    snapshots,
    activationsResult.rows as WorkflowSummarySource[],
    readWorkflowIdFromRow,
    'activations',
  );
  assignRows(
    snapshots,
    gatesResult.rows as WorkflowSummarySource[],
    readWorkflowIdFromRow,
    'gates',
  );
  return snapshots;
}

function createSnapshotMap(workflowIds: string[]): Map<string, WorkflowSummarySnapshot> {
  return new Map(
    workflowIds.map((workflowId) => [
      workflowId,
      {
        tasks: [],
        artifacts: [],
        events: [],
        stages: [],
        workItems: [],
        activations: [],
        gates: [],
      },
    ]),
  );
}

function assignRows(
  snapshots: Map<string, WorkflowSummarySnapshot>,
  rows: WorkflowSummarySource[],
  readWorkflowId: (row: WorkflowSummarySource) => string | null,
  key: keyof WorkflowSummarySnapshot,
): void {
  for (const row of rows) {
    const workflowId = readWorkflowId(row);
    if (!workflowId) {
      continue;
    }
    const snapshot = snapshots.get(workflowId);
    if (!snapshot) {
      continue;
    }
    snapshot[key].push(row);
  }
}

function readWorkflowIdFromRow(row: WorkflowSummarySource): string | null {
  return typeof row.workflow_id === 'string' && row.workflow_id.length > 0 ? row.workflow_id : null;
}
