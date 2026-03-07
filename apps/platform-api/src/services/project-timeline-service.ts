import type { DatabaseClient, DatabasePool } from '../db/database.js';
import type { StoredWorkflowDefinition } from '../orchestration/workflow-model.js';
import { readStoredWorkflow, readWorkflowRuntimeState, deriveWorkflowView } from '../orchestration/workflow-runtime.js';

const PROJECT_TIMELINE_KEY = 'project_timeline';
const PROJECT_LAST_SUMMARY_KEY = 'last_pipeline_summary';

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
    const summary = buildPipelineSummary(pipeline, tasks);

    await db.query(
      `UPDATE pipelines
          SET metadata = metadata || $3::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, pipelineId, { timeline_summary: summary }],
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
      return metadata.timeline_summary ?? buildTimelineFallback(row as Record<string, unknown>);
    });
  }
}

function buildPipelineSummary(
  pipeline: Record<string, unknown>,
  tasks: Array<Record<string, unknown>>,
) {
  const metadata = asRecord(pipeline.metadata);
  const workflow = readStoredWorkflow(metadata.workflow) as StoredWorkflowDefinition | null;
  const workflowRuntime = readWorkflowRuntimeState(metadata.workflow_runtime);
  const workflowView = deriveWorkflowView(workflow, tasks, workflowRuntime);
  const byState = countBy(tasks.map((task) => String(task.state)));
  const totalRework = tasks.reduce((sum, task) => sum + Number(task.rework_count ?? 0), 0);

  return {
    pipeline_id: String(pipeline.id),
    name: String(pipeline.name),
    state: String(pipeline.state),
    created_at: pipeline.created_at,
    started_at: pipeline.started_at ?? null,
    completed_at: pipeline.completed_at ?? null,
    task_counts: byState,
    rework_cycles: totalRework,
    phase_progression: workflowView.phases.map((phase) => ({
      name: phase.name,
      status: phase.status,
      gate_status: phase.gate_status,
      completed_tasks: phase.progress.completed_tasks,
      total_tasks: phase.progress.total_tasks,
    })),
    chain: {
      source_pipeline_id: metadata.chain_source_pipeline_id ?? null,
      child_pipeline_ids: Array.isArray(metadata.child_pipeline_ids)
        ? metadata.child_pipeline_ids
        : [],
    },
    link: `/pipelines/${String(pipeline.id)}`,
  };
}

function buildTimelineFallback(pipeline: Record<string, unknown>) {
  const metadata = asRecord(pipeline.metadata);
  return {
    pipeline_id: String(pipeline.id),
    name: String(pipeline.name),
    state: String(pipeline.state),
    created_at: pipeline.created_at,
    started_at: pipeline.started_at ?? null,
    completed_at: pipeline.completed_at ?? null,
    task_counts: {},
    rework_cycles: 0,
    phase_progression: [],
    chain: {
      source_pipeline_id: metadata.chain_source_pipeline_id ?? null,
      child_pipeline_ids: Array.isArray(metadata.child_pipeline_ids)
        ? metadata.child_pipeline_ids
        : [],
    },
    link: `/pipelines/${String(pipeline.id)}`,
  };
}

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
