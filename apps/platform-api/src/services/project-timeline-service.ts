import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { ConflictError } from '../errors/domain-errors.js';
import { buildPlaybookRunSummary } from './playbook-run-summary.js';

const PROJECT_TIMELINE_KEY = 'project_timeline';
const PROJECT_LAST_SUMMARY_KEY = 'last_workflow_summary';
const PROJECT_RUN_SUMMARIES_KEY = 'run_summaries';
const PROJECT_LAST_RUN_SUMMARY_KEY = 'last_run_summary';

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
    const [eventsResult, stagesResult, workItemsResult] = await Promise.all([
      db.query(
        `SELECT type, actor_type, actor_id, data, created_at
           FROM events
          WHERE tenant_id = $1
            AND (
              (
                entity_type = 'workflow'
                AND entity_id = $2
                AND type = ANY($3::text[])
              )
              OR (
                entity_type = 'gate'
                AND COALESCE(data->>'workflow_id', '') = $2
                AND type = ANY($4::text[])
              )
            )
          ORDER BY created_at ASC`,
        [
          tenantId,
          workflowId,
          [
            'stage.started',
            'stage.completed',
          ],
          [
            'stage.gate_requested',
            'stage.gate.approve',
            'stage.gate.reject',
            'stage.gate.request_changes',
          ],
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
    ]);
    const summary = buildWorkflowSummary(
      workflow,
      tasks,
      artifactsResult.rows as Array<Record<string, unknown>>,
      eventsResult.rows as Array<Record<string, unknown>>,
      stagesResult.rows as Array<Record<string, unknown>>,
      workItemsResult.rows as Array<Record<string, unknown>>,
    );

    await db.query(
      `UPDATE workflows
          SET metadata = metadata || $3::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, workflowId, { timeline_summary: summary, run_summary: summary }],
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
          [PROJECT_LAST_SUMMARY_KEY]: summary,
          [PROJECT_RUN_SUMMARIES_KEY]: nextTimeline,
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
      return metadata.run_summary ?? metadata.timeline_summary ?? null;
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
