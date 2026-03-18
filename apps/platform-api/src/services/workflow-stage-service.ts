import type { DatabaseClient, DatabasePool, DatabaseQueryable } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';
import type { PlaybookDefinition } from '../orchestration/playbook-model.js';

export interface WorkflowStageViewInput {
  id: string;
  lifecycle: string;
  name: string;
  position: number;
  goal: string;
  guidance: string | null;
  human_gate: boolean;
  status: string;
  gate_status: string;
  iteration_count: number;
  summary: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  open_work_item_count: number;
  total_work_item_count: number;
  first_work_item_at: Date | null;
  last_completed_work_item_at: Date | null;
}

export interface WorkflowStageResponse {
  id: string;
  name: string;
  position: number;
  goal: string;
  guidance: string | null;
  human_gate: boolean;
  status: string;
  is_active: boolean;
  gate_status: string;
  iteration_count: number;
  summary: string | null;
  started_at: string | null;
  completed_at: string | null;
  open_work_item_count: number;
  total_work_item_count: number;
}

interface CreatedWorkflowStageRow {
  id: string;
  name: string;
  position: number;
  goal: string;
  guidance: string | null;
  human_gate: boolean;
  status: string;
  gate_status: string;
  iteration_count: number;
  summary: string | null;
  started_at: Date | null;
  completed_at: Date | null;
}

export class WorkflowStageService {
  constructor(private readonly pool: DatabasePool) {}

  async createStages(
    tenantId: string,
    workflowId: string,
    definition: PlaybookDefinition,
    client: DatabaseClient,
  ) {
    if (definition.stages.length === 0) {
      return [];
    }

    const rows: WorkflowStageResponse[] = [];
    for (const [index, stage] of definition.stages.entries()) {
      const isActive = definition.lifecycle === 'planned' && index === 0;
      const result = await client.query<CreatedWorkflowStageRow>(
        `INSERT INTO workflow_stages (
           tenant_id, workflow_id, name, position, goal, guidance, human_gate, status, started_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8 = 'active' THEN now() ELSE NULL END)
         RETURNING id, name, position, goal, guidance, human_gate, status, gate_status, iteration_count, summary, started_at, completed_at`,
        [
          tenantId,
          workflowId,
          stage.name,
          index,
          stage.goal,
          stage.guidance ?? null,
          stage.human_gate ?? false,
          isActive ? 'active' : 'pending',
        ],
      );
      rows.push({
        ...result.rows[0],
        is_active: isActiveStageStatus(result.rows[0].status),
        started_at: result.rows[0].started_at?.toISOString() ?? null,
        completed_at: result.rows[0].completed_at?.toISOString() ?? null,
        open_work_item_count: 0,
        total_work_item_count: 0,
      });
    }
    return rows;
  }

  async listStages(tenantId: string, workflowId: string) {
    await this.assertWorkflow(tenantId, workflowId);
    return queryWorkflowStageViews(this.pool, tenantId, workflowId);
  }

  private async assertWorkflow(tenantId: string, workflowId: string) {
    const result = await this.pool.query(
      'SELECT id FROM workflows WHERE tenant_id = $1 AND id = $2',
      [tenantId, workflowId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workflow not found');
    }
  }
}

export function normalizeWorkflowStageView(
  row: WorkflowStageViewInput,
): WorkflowStageResponse {
  const derived = deriveStageView(row);
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    goal: row.goal,
    guidance: row.guidance,
    human_gate: row.human_gate,
    status: derived.status,
    is_active: derived.is_active,
    gate_status: row.gate_status,
    iteration_count: row.iteration_count,
    summary: row.summary,
    started_at: derived.started_at,
    completed_at: derived.completed_at,
    open_work_item_count: row.open_work_item_count,
    total_work_item_count: row.total_work_item_count,
  };
}

export function currentStageNameFromStages(
  stages: Array<Pick<WorkflowStageResponse, 'name' | 'status' | 'position'>>,
) {
  return stages
    .slice()
    .sort((left, right) => left.position - right.position)
    .find((stage) => isActiveStageStatus(stage.status))
    ?.name ?? null;
}

function deriveStageView(row: WorkflowStageViewInput) {
  const status = row.lifecycle === 'ongoing'
    ? deriveContinuousStageStatus(row)
    : derivePlannedStageStatus(row);
  const startedAt = row.started_at ?? row.first_work_item_at;
  const completedAt =
    status === 'completed' ? row.completed_at ?? row.last_completed_work_item_at : null;
  return {
    status,
    is_active: isActiveStageStatus(status),
    started_at: startedAt?.toISOString() ?? null,
    completed_at: completedAt?.toISOString() ?? null,
  };
}

function derivePlannedStageStatus(row: WorkflowStageViewInput) {
  if (row.gate_status === 'awaiting_approval') {
    return 'awaiting_gate';
  }
  if (row.gate_status === 'rejected') {
    return 'blocked';
  }
  if (row.open_work_item_count > 0 || row.gate_status === 'changes_requested') {
    return 'active';
  }
  if (row.total_work_item_count > 0 || row.status === 'completed') {
    return 'completed';
  }
  if (isActiveStageStatus(row.status)) {
    return row.status;
  }
  return 'pending';
}

function deriveContinuousStageStatus(row: WorkflowStageViewInput) {
  if (row.gate_status === 'awaiting_approval') {
    return 'awaiting_gate';
  }
  if (row.gate_status === 'rejected') {
    return 'blocked';
  }
  if (row.open_work_item_count > 0 || row.gate_status === 'changes_requested') {
    return 'active';
  }
  if (row.total_work_item_count > 0) {
    return 'completed';
  }
  return 'pending';
}

export function isActiveStageStatus(status: string) {
  return ['active', 'awaiting_gate', 'blocked'].includes(status);
}

export async function queryWorkflowStageViews(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
) {
  const result = await db.query<WorkflowStageViewInput>(
    `SELECT ws.id,
            w.lifecycle,
            ws.name,
            ws.position,
            ws.goal,
            ws.guidance,
            ws.human_gate,
            ws.status,
            ws.gate_status,
            ws.iteration_count,
            ws.summary,
            ws.started_at,
            ws.completed_at,
            COALESCE(work_item_summary.open_work_item_count, 0) AS open_work_item_count,
            COALESCE(work_item_summary.total_work_item_count, 0) AS total_work_item_count,
            work_item_summary.first_work_item_at,
            work_item_summary.last_completed_work_item_at
       FROM workflow_stages ws
       JOIN workflows w
         ON w.tenant_id = ws.tenant_id
        AND w.id = ws.workflow_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) FILTER (WHERE wi.completed_at IS NULL)::int AS open_work_item_count,
                COUNT(*)::int AS total_work_item_count,
                MIN(wi.created_at) AS first_work_item_at,
                MAX(wi.completed_at) AS last_completed_work_item_at
           FROM workflow_work_items wi
          WHERE wi.tenant_id = ws.tenant_id
            AND wi.workflow_id = ws.workflow_id
            AND wi.stage_name = ws.name
       ) AS work_item_summary
         ON true
      WHERE ws.tenant_id = $1
        AND ws.workflow_id = $2
      ORDER BY ws.position ASC`,
    [tenantId, workflowId],
  );
  return result.rows.map(normalizeWorkflowStageView);
}
