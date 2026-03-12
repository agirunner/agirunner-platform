import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
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
      playbook_id?: string;
      name?: string;
      parameters?: Record<string, unknown>;
    },
  ) {
    const sourceWorkflow = await this.fetchSourceWorkflow(identity.tenantId, sourceWorkflowId);
    if (!payload.playbook_id) {
      throw new ConflictError('Explicit workflow chaining requires a playbook_id');
    }

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

  async chainWorkflowFromSuggestedPlan(
    identity: ApiKeyIdentity,
    sourceWorkflowId: string,
    payload: { name?: string },
  ) {
    const sourceWorkflow = await this.fetchSourceWorkflow(identity.tenantId, sourceWorkflowId);
    if (!sourceWorkflow.project_id) {
      throw new ConflictError('Workflow chaining requires a project-scoped workflow');
    }

    const taskResult = await this.pool.query(
      `SELECT output
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND output IS NOT NULL
        ORDER BY completed_at DESC NULLS LAST, updated_at DESC
        LIMIT 1`,
      [identity.tenantId, sourceWorkflowId],
    );
    const output = asRecord(taskResult.rows[0]?.output);
    const suggestedPlan = asRecord(output.suggested_plan);
    const playbookRef = suggestedPlan.playbook;
    const parameters = asRecord(suggestedPlan.parameters);
    if (typeof playbookRef !== 'string' || playbookRef.trim().length === 0) {
      throw new ConflictError('Workflow output does not include a suggested plan playbook');
    }

    const playbookId = await this.resolvePlaybookId(identity.tenantId, playbookRef);
    const nextWorkflow = await this.workflowService.createWorkflow(identity, {
      playbook_id: playbookId,
      project_id: String(sourceWorkflow.project_id),
      name: payload.name ?? `${String(sourceWorkflow.name)} follow-up`,
      parameters,
      metadata: {
        parent_workflow_id: sourceWorkflowId,
        chain_origin: 'suggested_plan',
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

  private async resolvePlaybookId(tenantId: string, playbookRef: string) {
    const byId = await this.pool.query(
      `SELECT id
         FROM playbooks
        WHERE tenant_id = $1
          AND id::text = $2
          AND is_active = true
        LIMIT 1`,
      [tenantId, playbookRef],
    );
    if (byId.rowCount) {
      return String(byId.rows[0].id);
    }

    const bySlug = await this.pool.query(
      `SELECT id
         FROM playbooks
        WHERE tenant_id = $1
          AND slug = $2
          AND is_active = true
        ORDER BY version DESC, created_at DESC
        LIMIT 1`,
      [tenantId, playbookRef],
    );
    if (!bySlug.rowCount) {
      throw new NotFoundError('Suggested plan playbook not found');
    }
    return String(bySlug.rows[0].id);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function isTerminalWorkflowState(value: unknown) {
  return value === 'completed' || value === 'failed' || value === 'cancelled';
}
