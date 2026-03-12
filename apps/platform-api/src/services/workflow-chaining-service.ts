import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';
import { WorkflowService } from './workflow-service.js';
import { ProjectTimelineService } from './project-timeline-service.js';

export class WorkflowChainingService {
  private readonly projectTimelineService: ProjectTimelineService;

  constructor(
    private readonly pool: DatabasePool,
    private readonly workflowService: WorkflowService,
  ) {
    this.projectTimelineService = new ProjectTimelineService(pool);
  }

  async chainWorkflowExplicit(
    identity: ApiKeyIdentity,
    sourceWorkflowId: string,
    payload: {
      playbook_id: string;
      name?: string;
      parameters?: Record<string, unknown>;
    },
  ) {
    const sourceWorkflow = await this.fetchSourceWorkflow(identity.tenantId, sourceWorkflowId);
    const nextWorkflow = await this.workflowService.createWorkflow(identity, {
      playbook_id: payload.playbook_id,
      project_id: sourceWorkflow.project_id ? String(sourceWorkflow.project_id) : undefined,
      name: payload.name ?? `${String(sourceWorkflow.name)} follow-up`,
      parameters: payload.parameters,
      metadata: {
        parent_workflow_id: sourceWorkflowId,
        chain_origin: 'explicit',
      },
    });

    await this.linkChildWorkflow(
      identity.tenantId,
      sourceWorkflowId,
      sourceWorkflow,
      nextWorkflow.id,
    );

    return nextWorkflow;
  }

  private async fetchSourceWorkflow(tenantId: string, workflowId: string) {
    const result = await this.pool.query(
      'SELECT * FROM workflows WHERE tenant_id = $1 AND id = $2',
      [tenantId, workflowId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workflow not found');
    }
    return result.rows[0] as Record<string, unknown>;
  }

  private async linkChildWorkflow(
    tenantId: string,
    sourceWorkflowId: string,
    sourceWorkflow: Record<string, unknown>,
    childWorkflowId: string,
  ) {
    const sourceMetadata = asRecord(sourceWorkflow.metadata);
    const childWorkflowIds = Array.isArray(sourceMetadata.child_workflow_ids)
      ? [...(sourceMetadata.child_workflow_ids as unknown[]), childWorkflowId]
      : [childWorkflowId];
    await this.pool.query(
      `UPDATE workflows
          SET metadata = metadata || $3::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [
        tenantId,
        sourceWorkflowId,
        {
          child_workflow_ids: childWorkflowIds,
          latest_child_workflow_id: childWorkflowId,
        },
      ],
    );
    if (isTerminalWorkflowState(sourceWorkflow.state)) {
      await this.projectTimelineService.recordWorkflowTerminalState(tenantId, sourceWorkflowId);
    }
  }
}

function isTerminalWorkflowState(value: unknown) {
  return value === 'completed' || value === 'failed' || value === 'cancelled';
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
