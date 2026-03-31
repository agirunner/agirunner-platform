import type { DatabasePool } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';
import { loadGateResumeHistory } from './gate-resume-history.js';
import { toTaskApproval } from './approval-queue-service/mappers.js';
import {
  queryGate,
  queryPendingApprovals,
  queryWorkflowGates,
} from './approval-queue-service/queries.js';
import type { ApprovalStageRow } from './approval-queue-service/types.js';
import { toGateResponse } from './workflow-stage/workflow-stage-gate-service.js';

export class ApprovalQueueService {
  constructor(private readonly pool: DatabasePool) {}

  async listApprovals(tenantId: string) {
    const { tasks, stageGates } = await queryPendingApprovals(this.pool, tenantId);
    const stageGateRows = await this.attachGateResumeHistory(tenantId, stageGates.rows);

    return {
      task_approvals: tasks.rows.map(toTaskApproval),
      stage_gates: stageGateRows.map((row) => toGateResponse(row)),
    };
  }

  async listWorkflowGates(tenantId: string, workflowId: string) {
    const result = await queryWorkflowGates(this.pool, tenantId, workflowId);
    const rows = await this.attachGateResumeHistory(tenantId, result.rows, workflowId);
    return rows.map((row) => toGateResponse(row));
  }

  async getGate(tenantId: string, gateId: string, workflowId?: string) {
    const result = await queryGate(this.pool, tenantId, gateId, workflowId);
    if (!result.rowCount) {
      throw new NotFoundError('Workflow stage gate not found');
    }

    const rows = await this.attachGateResumeHistory(
      tenantId,
      result.rows,
      workflowId ?? result.rows[0].workflow_id,
    );
    return toGateResponse(rows[0]);
  }

  private async attachGateResumeHistory(
    tenantId: string,
    rows: ApprovalStageRow[],
    workflowId?: string,
  ): Promise<ApprovalStageRow[]> {
    if (rows.length === 0) {
      return rows;
    }

    const resumeHistory = await loadGateResumeHistory(
      this.pool,
      tenantId,
      rows.map((row) => row.id),
      workflowId,
    );
    return rows.map((row) => ({
      ...row,
      resume_activation_history: resumeHistory.get(row.id) ?? [],
    }));
  }
}
