import type { DatabaseQueryable } from '../db/database.js';

interface WorkflowDeliverableHandoffRow {
  id: string;
  workflow_id: string;
  work_item_id: string;
  task_id: string;
  role: string | null;
  summary: string;
  completion: string;
  completion_state: string | null;
  resolution: string | null;
  decision_state: string | null;
  created_at: Date;
  work_item_title: string | null;
}

export interface WorkflowDeliverableHandoffRecord {
  id: string;
  workflow_id: string;
  work_item_id: string;
  task_id: string;
  role: string | null;
  summary: string;
  completion: string;
  completion_state: string | null;
  resolution: string | null;
  decision_state: string | null;
  created_at: string;
  work_item_title: string | null;
}

export class WorkflowDeliverableHandoffService {
  constructor(private readonly pool: DatabaseQueryable) {}

  async listLatestCompletedWorkItemHandoffs(
    tenantId: string,
    workflowId: string,
    input: { workItemId?: string } = {},
  ): Promise<WorkflowDeliverableHandoffRecord[]> {
    const result = await this.pool.query<WorkflowDeliverableHandoffRow>(
      `SELECT DISTINCT ON (th.work_item_id)
              th.id,
              th.workflow_id,
              th.work_item_id,
              th.task_id,
              th.role,
              th.summary,
              th.completion,
              COALESCE(th.completion_state, th.completion) AS completion_state,
              th.resolution,
              COALESCE(th.decision_state, th.resolution) AS decision_state,
              th.created_at,
              wi.title AS work_item_title
         FROM task_handoffs th
         JOIN workflow_work_items wi
           ON wi.tenant_id = th.tenant_id
          AND wi.workflow_id = th.workflow_id
          AND wi.id = th.work_item_id
        WHERE th.tenant_id = $1
          AND th.workflow_id = $2
          AND wi.completed_at IS NOT NULL
          AND ($3::uuid IS NULL OR th.work_item_id = $3::uuid)
        ORDER BY th.work_item_id,
                 CASE WHEN th.role = 'orchestrator' THEN 1 ELSE 0 END,
                 th.sequence DESC,
                 th.created_at DESC`,
      [tenantId, workflowId, input.workItemId ?? null],
    );
    return result.rows.map((row) => ({
      id: row.id,
      workflow_id: row.workflow_id,
      work_item_id: row.work_item_id,
      task_id: row.task_id,
      role: readOptionalString(row.role),
      summary: row.summary,
      completion: row.completion,
      completion_state: readOptionalString(row.completion_state),
      resolution: readOptionalString(row.resolution),
      decision_state: readOptionalString(row.decision_state),
      created_at: row.created_at.toISOString(),
      work_item_title: readOptionalString(row.work_item_title),
    }));
  }
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
