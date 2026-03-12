import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { ConflictError } from '../errors/domain-errors.js';
import { buildPlaybookRunSummary } from './playbook-run-summary.js';

const PROJECT_TIMELINE_KEY = 'project_timeline';
const PROJECT_LAST_RUN_SUMMARY_KEY = 'last_run_summary';
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
const WORK_ITEM_TIMELINE_EVENT_TYPES = [
  'work_item.created',
  'work_item.updated',
] as const;

export class ProjectTimelineService {
  constructor(private readonly pool: DatabasePool) {}

  async recordWorkflowTerminalState(
    tenantId: string,
    workflowId: string,
    client?: DatabaseClient,
  ) {
    const db = client ?? this.pool;
    const workflowResult = await db.query(
      'SELECT * FROM workflows WHERE tenant_id = $1 AND id = $2',
      [tenantId, workflowId],
    );
    if (!workflowResult.rowCount) {
      return null;
    }
    const workflow = workflowResult.rows[0] as Record<string, unknown>;
    if (!workflow.project_id) {
      return null;
    }
    if (!workflow.playbook_id) {
      throw new ConflictError('Project timeline summaries only support playbook workflows');
    }

    const tasksResult = await db.query(
      'SELECT * FROM tasks WHERE tenant_id = $1 AND workflow_id = $2 ORDER BY created_at ASC',
      [tenantId, workflowId],
    );
    const tasks = tasksResult.rows.map((row) => row as Record<string, unknown>);
    const artifactsResult = await db.query(
      `SELECT id, task_id, logical_path, content_type, size_bytes, created_at
         FROM workflow_artifacts
        WHERE tenant_id = $1
         AND workflow_id = $2
        ORDER BY created_at ASC`,
      [tenantId, workflowId],
    );
    const [eventsResult, stagesResult, workItemsResult, activationsResult, gatesResult] = await Promise.all([
      db.query(
        `SELECT e.type, e.actor_type, e.actor_id, e.data, e.created_at
           FROM events e
           LEFT JOIN tasks task_events
             ON e.entity_type = 'task'
            AND task_events.tenant_id = e.tenant_id
            AND task_events.id::text = e.entity_id::text
          WHERE e.tenant_id = $1
            AND (
              (
                e.entity_type = 'workflow'
                AND e.entity_id = $2
                AND e.type = ANY($3::text[])
              )
              OR (
                e.entity_type = 'workflow'
                AND COALESCE(e.data->>'parent_workflow_id', '') = $2::text
                AND e.type = ANY($4::text[])
              )
              OR (
                e.entity_type = 'gate'
                AND COALESCE(e.data->>'workflow_id', '') = $2::text
                AND e.type = ANY($5::text[])
              )
              OR (
                e.entity_type = 'task'
                AND task_events.workflow_id = $2::uuid
                AND e.type = ANY($6::text[])
              )
              OR (
                e.entity_type = 'work_item'
                AND COALESCE(e.data->>'workflow_id', '') = $2::text
                AND e.type = ANY($7::text[])
              )
            )
          ORDER BY e.created_at ASC`,
        [
          tenantId,
          workflowId,
          [...WORKFLOW_TIMELINE_EVENT_TYPES],
          [...CHILD_WORKFLOW_TIMELINE_EVENT_TYPES],
          [...GATE_TIMELINE_EVENT_TYPES],
          [...TASK_TIMELINE_EVENT_TYPES],
          [...WORK_ITEM_TIMELINE_EVENT_TYPES],
        ],
      ),
      db.query(
        `SELECT name, goal, human_gate, status, gate_status, iteration_count, summary, started_at, completed_at
           FROM workflow_stages
          WHERE tenant_id = $1
            AND workflow_id = $2
          ORDER BY position ASC`,
        [tenantId, workflowId],
      ),
      db.query(
        `SELECT id, stage_name, column_id, title, completed_at
           FROM workflow_work_items
          WHERE tenant_id = $1
            AND workflow_id = $2
          ORDER BY created_at ASC`,
        [tenantId, workflowId],
      ),
      db.query(
        `SELECT activation_id, state, reason, event_type, COALESCE(payload->>'task_id', '') AS task_id,
                queued_at, started_at, consumed_at, completed_at, error
           FROM workflow_activations
          WHERE tenant_id = $1
            AND workflow_id = $2
            AND activation_id IS NOT NULL
          ORDER BY queued_at ASC`,
        [tenantId, workflowId],
      ),
      db.query(
        `SELECT id, stage_name, status, request_summary, recommendation, concerns, key_artifacts,
                requested_by_type, requested_by_id, requested_at,
                decision_feedback, decided_by_type, decided_by_id, decided_at
           FROM workflow_stage_gates
          WHERE tenant_id = $1
            AND workflow_id = $2
          ORDER BY requested_at ASC`,
        [tenantId, workflowId],
      ),
    ]);
    const summary = buildWorkflowSummary(
      workflow,
      tasks,
      artifactsResult.rows as Array<Record<string, unknown>>,
      eventsResult.rows as Array<Record<string, unknown>>,
      stagesResult.rows as Array<Record<string, unknown>>,
      workItemsResult.rows as Array<Record<string, unknown>>,
      activationsResult.rows as Array<Record<string, unknown>>,
      gatesResult.rows as Array<Record<string, unknown>>,
    );

    await db.query(
      `UPDATE workflows
          SET metadata = metadata || $3::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, workflowId, { run_summary: summary }],
    );

    const projectResult = await db.query(
      'SELECT memory FROM projects WHERE tenant_id = $1 AND id = $2',
      [tenantId, workflow.project_id],
    );
    const currentMemory = asRecord(projectResult.rows[0]?.memory);
    const existingTimeline = Array.isArray(currentMemory[PROJECT_TIMELINE_KEY])
      ? ([...(currentMemory[PROJECT_TIMELINE_KEY] as unknown[])] as Array<Record<string, unknown>>)
      : [];
    const nextTimeline = [summary, ...existingTimeline.filter((entry) => entry.workflow_id !== workflowId)]
      .sort((left, right) =>
        String(right.completed_at ?? right.created_at).localeCompare(
          String(left.completed_at ?? left.created_at),
        ),
      )
      .slice(0, 50);

    await db.query(
      `UPDATE projects
          SET memory = $3::jsonb,
              memory_size_bytes = octet_length($3::jsonb::text),
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [
        tenantId,
        workflow.project_id,
        {
          ...currentMemory,
          [PROJECT_TIMELINE_KEY]: nextTimeline,
          [PROJECT_LAST_RUN_SUMMARY_KEY]: summary,
        },
      ],
    );

    return summary;
  }

  async getProjectTimeline(tenantId: string, projectId: string) {
    const workflowsResult = await this.pool.query(
      `SELECT id, name, state, started_at, completed_at, created_at, metadata
         FROM workflows
        WHERE tenant_id = $1
          AND project_id = $2
        ORDER BY COALESCE(completed_at, created_at) DESC`,
      [tenantId, projectId],
    );

    return workflowsResult.rows.map((row) => {
      const metadata = asRecord(row.metadata);
      return metadata.run_summary ?? null;
    }).filter((entry): entry is Record<string, unknown> => Boolean(entry));
  }
}

function buildWorkflowSummary(
  workflowRow: Record<string, unknown>,
  tasks: Array<Record<string, unknown>>,
  artifacts: Array<Record<string, unknown>>,
  events: Array<Record<string, unknown>>,
  stages: Array<Record<string, unknown>> = [],
  workItems: Array<Record<string, unknown>> = [],
  activations: Array<Record<string, unknown>> = [],
  gates: Array<Record<string, unknown>> = [],
) {
  return buildPlaybookRunSummary({
    workflow: workflowRow,
    tasks,
    stages: stages.map((row) => ({
      name: String(row.name),
      goal: String(row.goal),
      human_gate: Boolean(row.human_gate),
      status: String(row.status),
      gate_status: String(row.gate_status),
      iteration_count: Number(row.iteration_count ?? 0),
      summary: typeof row.summary === 'string' ? row.summary : null,
      started_at: asDate(row.started_at),
      completed_at: asDate(row.completed_at),
    })),
    workItems: workItems.map((row) => ({
      id: String(row.id),
      stage_name: String(row.stage_name),
      column_id: String(row.column_id),
      title: String(row.title),
      completed_at: asDate(row.completed_at),
    })),
    artifacts: artifacts.map((row) => ({
      id: String(row.id),
      task_id: String(row.task_id),
      logical_path: String(row.logical_path),
      content_type: String(row.content_type),
      size_bytes: Number(row.size_bytes ?? 0),
      created_at: new Date(String(row.created_at)),
    })),
    events: events.map((row) => ({
      type: String(row.type),
      actor_type: String(row.actor_type),
      actor_id: typeof row.actor_id === 'string' ? row.actor_id : null,
      data: asRecord(row.data),
      created_at: new Date(String(row.created_at)),
    })),
    activations: activations.map((row) => ({
      activation_id: typeof row.activation_id === 'string' && row.activation_id.length > 0 ? row.activation_id : null,
      state: String(row.state),
      reason: typeof row.reason === 'string' && row.reason.length > 0 ? row.reason : null,
      event_type: String(row.event_type),
      task_id: typeof row.task_id === 'string' && row.task_id.length > 0 ? row.task_id : null,
      queued_at: new Date(String(row.queued_at)),
      started_at: asDate(row.started_at),
      consumed_at: asDate(row.consumed_at),
      completed_at: asDate(row.completed_at),
      error: asRecordOrNull(row.error),
    })),
    gates: gates.map((row) => ({
      id: String(row.id),
      stage_name: String(row.stage_name),
      status: String(row.status),
      request_summary: String(row.request_summary),
      recommendation: typeof row.recommendation === 'string' && row.recommendation.length > 0 ? row.recommendation : null,
      concerns: Array.isArray(row.concerns) ? row.concerns : [],
      key_artifacts: Array.isArray(row.key_artifacts) ? row.key_artifacts : [],
      requested_by_type: String(row.requested_by_type),
      requested_by_id: typeof row.requested_by_id === 'string' && row.requested_by_id.length > 0 ? row.requested_by_id : null,
      requested_at: new Date(String(row.requested_at)),
      decision_feedback: typeof row.decision_feedback === 'string' && row.decision_feedback.length > 0 ? row.decision_feedback : null,
      decided_by_type: typeof row.decided_by_type === 'string' && row.decided_by_type.length > 0 ? row.decided_by_type : null,
      decided_by_id: typeof row.decided_by_id === 'string' && row.decided_by_id.length > 0 ? row.decided_by_id : null,
      decided_at: asDate(row.decided_at),
    })),
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function asRecordOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
