import type { DatabaseClient, DatabasePool } from '../db/database.js';
import type { StoredWorkflowDefinition } from '../orchestration/workflow-model.js';
import { readStoredWorkflow, readWorkflowRuntimeState, deriveWorkflowView } from '../orchestration/workflow-runtime.js';
import { buildRunSummary, buildRunSummaryFallback } from './project-run-summary.js';

const PROJECT_TIMELINE_KEY = 'project_timeline';
const PROJECT_LAST_SUMMARY_KEY = 'last_pipeline_summary';
const PROJECT_RUN_SUMMARIES_KEY = 'run_summaries';
const PROJECT_LAST_RUN_SUMMARY_KEY = 'last_run_summary';

export class ProjectTimelineService {
  constructor(private readonly pool: DatabasePool) {}

  async recordPipelineTerminalState(
    tenantId: string,
    pipelineId: string,
    client?: DatabaseClient,
  ) {
    const db = client ?? this.pool;
    const pipelineResult = await db.query(
      'SELECT * FROM pipelines WHERE tenant_id = $1 AND id = $2',
      [tenantId, pipelineId],
    );
    if (!pipelineResult.rowCount) {
      return null;
    }
    const pipeline = pipelineResult.rows[0] as Record<string, unknown>;
    if (!pipeline.project_id) {
      return null;
    }

    const tasksResult = await db.query(
      'SELECT * FROM tasks WHERE tenant_id = $1 AND pipeline_id = $2 ORDER BY created_at ASC',
      [tenantId, pipelineId],
    );
    const tasks = tasksResult.rows.map((row) => row as Record<string, unknown>);
    const artifactsResult = await db.query(
      `SELECT id, task_id, logical_path, content_type, size_bytes, created_at
         FROM pipeline_artifacts
        WHERE tenant_id = $1
          AND pipeline_id = $2
        ORDER BY created_at ASC`,
      [tenantId, pipelineId],
    );
    const eventsResult = await db.query(
      `SELECT type, actor_type, actor_id, data, created_at
         FROM events
        WHERE tenant_id = $1
          AND entity_type = 'pipeline'
          AND entity_id = $2
          AND type = ANY($3::text[])
        ORDER BY created_at ASC`,
      [
        tenantId,
        pipelineId,
        [
          'phase.started',
          'phase.completed',
          'phase.gate.awaiting_approval',
          'phase.gate.approved',
          'phase.gate.rejected',
          'phase.gate.request_changes',
        ],
      ],
    );
    const summary = buildPipelineSummary(
      pipeline,
      tasks,
      artifactsResult.rows as Array<Record<string, unknown>>,
      eventsResult.rows as Array<Record<string, unknown>>,
    );

    await db.query(
      `UPDATE pipelines
          SET metadata = metadata || $3::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, pipelineId, { timeline_summary: summary, run_summary: summary }],
    );

    const projectResult = await db.query(
      'SELECT memory FROM projects WHERE tenant_id = $1 AND id = $2',
      [tenantId, pipeline.project_id],
    );
    const currentMemory = asRecord(projectResult.rows[0]?.memory);
    const existingTimeline = Array.isArray(currentMemory[PROJECT_TIMELINE_KEY])
      ? ([...(currentMemory[PROJECT_TIMELINE_KEY] as unknown[])] as Array<Record<string, unknown>>)
      : [];
    const nextTimeline = [summary, ...existingTimeline.filter((entry) => entry.pipeline_id !== pipelineId)]
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
        pipeline.project_id,
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
    const pipelinesResult = await this.pool.query(
      `SELECT id, name, state, started_at, completed_at, created_at, metadata
         FROM pipelines
        WHERE tenant_id = $1
          AND project_id = $2
        ORDER BY COALESCE(completed_at, created_at) DESC`,
      [tenantId, projectId],
    );

    return pipelinesResult.rows.map((row) => {
      const metadata = asRecord(row.metadata);
      return (
        metadata.run_summary ??
        metadata.timeline_summary ??
        buildTimelineFallback(row as Record<string, unknown>)
      );
    });
  }
}

function buildPipelineSummary(
  pipeline: Record<string, unknown>,
  tasks: Array<Record<string, unknown>>,
  artifacts: Array<Record<string, unknown>>,
  events: Array<Record<string, unknown>>,
) {
  const metadata = asRecord(pipeline.metadata);
  const workflow = readStoredWorkflow(metadata.workflow) as StoredWorkflowDefinition | null;
  const workflowRuntime = readWorkflowRuntimeState(metadata.workflow_runtime);
  const workflowView = deriveWorkflowView(workflow, tasks, workflowRuntime);
  return buildRunSummary({
    pipeline,
    tasks,
    workflow,
    workflowView,
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

function buildTimelineFallback(pipeline: Record<string, unknown>) {
  return buildRunSummaryFallback(pipeline);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
