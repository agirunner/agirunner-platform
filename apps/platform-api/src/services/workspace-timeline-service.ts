import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { ConflictError } from '../errors/domain-errors.js';
import { loadWorkflowSummarySnapshots } from './workspace-timeline-summary-loader.js';
import {
  buildWorkflowSummary,
  type WorkflowSummarySnapshot,
} from './workspace-timeline-summary-support.js';

const WORKSPACE_TIMELINE_KEY = 'workspace_timeline';
const WORKSPACE_LAST_RUN_SUMMARY_KEY = 'last_run_summary';
const WORKFLOW_TIMELINE_COLUMNS = [
  'id',
  'workspace_id',
  'playbook_id',
  'name',
  'state',
  'lifecycle',
  'metadata',
  'created_at',
  'started_at',
  'completed_at',
].join(', ');

export class WorkspaceTimelineService {
  constructor(private readonly pool: DatabasePool) {}

  async recordWorkflowTerminalState(tenantId: string, workflowId: string, client?: DatabaseClient) {
    const db = client ?? this.pool;
    const workflowResult = await db.query(
      `SELECT ${WORKFLOW_TIMELINE_COLUMNS}
         FROM workflows
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, workflowId],
    );
    if (!workflowResult.rowCount) {
      return null;
    }
    const workflow = workflowResult.rows[0] as Record<string, unknown>;
    if (!workflow.workspace_id) {
      return null;
    }
    if (!workflow.playbook_id) {
      throw new ConflictError('Workspace timeline summaries only support playbook workflows');
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

    const workspaceResult = await db.query(
      'SELECT memory FROM workspaces WHERE tenant_id = $1 AND id = $2',
      [tenantId, workflow.workspace_id],
    );
    const currentMemory = asRecord(workspaceResult.rows[0]?.memory);
    const existingTimeline = Array.isArray(currentMemory[WORKSPACE_TIMELINE_KEY])
      ? ([...(currentMemory[WORKSPACE_TIMELINE_KEY] as unknown[])] as Array<Record<string, unknown>>)
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
      `UPDATE workspaces
          SET memory = $3::jsonb,
              memory_size_bytes = octet_length($3::jsonb::text),
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [
        tenantId,
        workflow.workspace_id,
        {
          ...currentMemory,
          [WORKSPACE_TIMELINE_KEY]: nextTimeline,
          [WORKSPACE_LAST_RUN_SUMMARY_KEY]: summary,
        },
      ],
    );

    return summary;
  }

  async getWorkspaceTimeline(tenantId: string, workspaceId: string) {
    const workflowsResult = await this.pool.query(
      `SELECT id, name, state, lifecycle, playbook_id, started_at, completed_at, created_at, metadata
         FROM workflows
        WHERE tenant_id = $1
          AND workspace_id = $2
        ORDER BY COALESCE(completed_at, created_at) DESC`,
      [tenantId, workspaceId],
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
      .map((row) => buildWorkspaceTimelineEntry(row, summarySnapshots))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function buildWorkspaceTimelineEntry(
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
