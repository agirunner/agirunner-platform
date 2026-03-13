import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { ConflictError } from '../errors/domain-errors.js';
import {
  buildWorkflowSummary,
  loadWorkflowSummarySnapshots,
  type WorkflowSummarySnapshot,
} from './project-timeline-summary-loader.js';
import { buildWorkflowReadColumns } from './workflow-read-columns.js';

const PROJECT_TIMELINE_KEY = 'project_timeline';
const PROJECT_LAST_RUN_SUMMARY_KEY = 'last_run_summary';

export class ProjectTimelineService {
  constructor(private readonly pool: DatabasePool) {}

  async recordWorkflowTerminalState(tenantId: string, workflowId: string, client?: DatabaseClient) {
    const db = client ?? this.pool;
    const workflowResult = await db.query(
      `SELECT ${buildWorkflowReadColumns()} FROM workflows WHERE tenant_id = $1 AND id = $2`,
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

    const summarySnapshots = await loadWorkflowSummarySnapshots(db, tenantId, [workflowId]);
    const summary = buildWorkflowSummary(
      workflow,
      summarySnapshots.get(workflowId) ?? emptyWorkflowSummarySnapshot(),
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
    const nextTimeline = [
      summary,
      ...existingTimeline.filter((entry) => entry.workflow_id !== workflowId),
    ]
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
      `SELECT id, name, state, lifecycle, playbook_id, started_at, completed_at, created_at, metadata
         FROM workflows
        WHERE tenant_id = $1
          AND project_id = $2
        ORDER BY COALESCE(completed_at, created_at) DESC`,
      [tenantId, projectId],
    );
    const workflowRows = workflowsResult.rows as Array<Record<string, unknown>>;
    const playbookWorkflowIds = workflowRows
      .filter((row) => Boolean(row.playbook_id))
      .map((row) => String(row.id));
    const summarySnapshots = await loadWorkflowSummarySnapshots(
      this.pool,
      tenantId,
      playbookWorkflowIds,
    );

    return workflowRows
      .map((row) => buildProjectTimelineEntry(row, summarySnapshots))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function buildProjectTimelineEntry(
  workflowRow: Record<string, unknown>,
  summarySnapshots: Map<string, WorkflowSummarySnapshot>,
): Record<string, unknown> | null {
  if (!workflowRow.playbook_id) {
    return null;
  }
  const workflowId = String(workflowRow.id);
  return buildWorkflowSummary(
    workflowRow,
    summarySnapshots.get(workflowId) ?? emptyWorkflowSummarySnapshot(),
  );
}

function emptyWorkflowSummarySnapshot(): WorkflowSummarySnapshot {
  return {
    tasks: [],
    artifacts: [],
    events: [],
    stages: [],
    workItems: [],
    activations: [],
    gates: [],
  };
}
