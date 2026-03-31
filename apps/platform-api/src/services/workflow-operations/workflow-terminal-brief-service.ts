import { randomUUID } from 'node:crypto';

import type { DatabaseQueryable } from '../../db/database.js';
import { NotFoundError } from '../../errors/domain-errors.js';
import type { WorkflowOperatorBriefService } from '../workflow-operator/workflow-operator-brief-service.js';

interface TerminalWorkflowRow {
  id: string;
  name: string;
  state: string;
  completion_callouts: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

interface ExistingBriefRow {
  id: string;
}

export class WorkflowTerminalBriefService {
  constructor(
    private readonly pool: DatabaseQueryable,
    private readonly briefService: Pick<WorkflowOperatorBriefService, 'recordBrief'>,
  ) {}

  async ensureTerminalBrief(input: { tenantId: string; workflowId: string }) {
    const workflow = await this.readWorkflow(input.tenantId, input.workflowId);
    const existing = await this.pool.query<ExistingBriefRow>(
      `SELECT id
         FROM workflow_operator_briefs
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND brief_kind = 'terminal'
        ORDER BY created_at DESC
        LIMIT 1`,
      [input.tenantId, input.workflowId],
    );
    if (existing.rowCount) {
      return existing.rows[0];
    }

    return this.briefService.recordBrief(
      {
        id: 'platform-terminal-brief',
        tenantId: input.tenantId,
        scope: 'admin',
        ownerType: 'system',
        ownerId: null,
        keyPrefix: 'platform',
      } as never,
      input.workflowId,
      {
        requestId: randomUUID(),
        executionContextId: randomUUID(),
        briefKind: 'terminal',
        briefScope: 'workflow_timeline',
        sourceKind: 'platform',
        sourceRoleName: 'Platform',
        statusKind: workflow.state,
        payload: {
          shortBrief: {
            headline: `${workflow.name} ${humanizeTerminalState(workflow.state)}.`,
            status_label: humanizeTerminalState(workflow.state),
            delta_label: workflow.state,
            next_action_label: workflow.state === 'failed' ? 'Review terminal brief or redrive' : 'Review workflow outcome',
          },
          detailedBriefJson: {
            headline: `${workflow.name} ${humanizeTerminalState(workflow.state)}.`,
            status_kind: workflow.state,
            summary: readSummary(workflow),
            sections: {
              risks_and_callouts: readStringArray(workflow.completion_callouts?.risks_and_callouts),
              decisions_made: readStringArray(workflow.completion_callouts?.decisions_made),
            },
          },
        },
      },
    );
  }

  private async readWorkflow(tenantId: string, workflowId: string): Promise<TerminalWorkflowRow> {
    const result = await this.pool.query<TerminalWorkflowRow>(
      `SELECT id, name, state, completion_callouts, metadata
         FROM workflows
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, workflowId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workflow not found');
    }
    return result.rows[0];
  }
}

function humanizeTerminalState(state: string): string {
  switch (state) {
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'was cancelled';
    case 'completed':
      return 'completed';
    default:
      return 'finished';
  }
}

function readSummary(workflow: TerminalWorkflowRow): string {
  const metadata = workflow.metadata ?? {};
  const finalSummary = metadata.final_summary;
  if (typeof finalSummary === 'string' && finalSummary.trim().length > 0) {
    return finalSummary.trim();
  }
  return `${workflow.name} ${humanizeTerminalState(workflow.state)}.`;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}
