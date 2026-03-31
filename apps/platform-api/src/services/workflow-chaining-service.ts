import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';
import { WorkflowService } from './workflow-service/workflow-service.js';
import { WorkspaceTimelineService } from './workspace/timeline/workspace-timeline-service.js';
import {
  PLATFORM_CONTROL_PLANE_IDEMPOTENT_MUTATION_REPLAY_ID,
  mustGetSafetynetEntry,
} from './safetynet/registry.js';
import { logSafetynetTriggered } from './safetynet/logging.js';

const IDEMPOTENT_MUTATION_REPLAY_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_CONTROL_PLANE_IDEMPOTENT_MUTATION_REPLAY_ID,
);

export class WorkflowChainingService {
  private readonly workspaceTimelineService: WorkspaceTimelineService;

  constructor(
    private readonly pool: DatabasePool,
    private readonly workflowService: WorkflowService,
  ) {
    this.workspaceTimelineService = new WorkspaceTimelineService(pool);
  }

  async chainWorkflowExplicit(
    identity: ApiKeyIdentity,
    sourceWorkflowId: string,
    payload: {
      request_id?: string;
      playbook_id: string;
      name?: string;
      parameters?: Record<string, string>;
    },
  ) {
    const sourceWorkflow = await this.fetchSourceWorkflow(identity.tenantId, sourceWorkflowId);
    const requestId = payload.request_id?.trim();
    const nextWorkflow = requestId
      ? await this.createOrReuseChainedWorkflow(identity, sourceWorkflowId, sourceWorkflow, payload, requestId)
      : await this.workflowService.createWorkflow(identity, {
          playbook_id: payload.playbook_id,
          workspace_id: sourceWorkflow.workspace_id ? String(sourceWorkflow.workspace_id) : undefined,
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
      String(nextWorkflow.id),
    );

    return nextWorkflow;
  }

  private async createOrReuseChainedWorkflow(
    identity: ApiKeyIdentity,
    sourceWorkflowId: string,
    sourceWorkflow: Record<string, unknown>,
    payload: {
      playbook_id: string;
      name?: string;
      parameters?: Record<string, string>;
    },
    requestId: string,
  ) {
    const existing = await this.loadExistingChainedWorkflow(identity, sourceWorkflowId, requestId);
    if (existing) {
      logSafetynetTriggered(
        IDEMPOTENT_MUTATION_REPLAY_SAFETYNET,
        'idempotent chained workflow request returned stored workflow',
        { workflow_id: sourceWorkflowId, request_id: requestId },
      );
      return existing;
    }

    try {
      return await this.workflowService.createWorkflow(identity, {
        playbook_id: payload.playbook_id,
        workspace_id: sourceWorkflow.workspace_id ? String(sourceWorkflow.workspace_id) : undefined,
        name: payload.name ?? `${String(sourceWorkflow.name)} follow-up`,
        parameters: payload.parameters,
        metadata: {
          parent_workflow_id: sourceWorkflowId,
          chain_origin: 'explicit',
          create_request_id: requestId,
        },
      });
    } catch (error) {
      if (!isWorkflowCreateRequestConflict(error)) {
        throw error;
      }
      const conflicted = await this.loadExistingChainedWorkflow(identity, sourceWorkflowId, requestId);
      if (!conflicted) {
        throw error;
      }
      logSafetynetTriggered(
        IDEMPOTENT_MUTATION_REPLAY_SAFETYNET,
        'idempotent chained workflow request returned stored workflow after conflict',
        { workflow_id: sourceWorkflowId, request_id: requestId },
      );
      return conflicted;
    }
  }

  private async fetchSourceWorkflow(tenantId: string, workflowId: string) {
    const result = await this.pool.query(
      'SELECT id, workspace_id, name, state, metadata FROM workflows WHERE tenant_id = $1 AND id = $2',
      [tenantId, workflowId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workflow not found');
    }
    return result.rows[0] as Record<string, unknown>;
  }

  private async loadExistingChainedWorkflow(
    identity: ApiKeyIdentity,
    sourceWorkflowId: string,
    requestId: string,
  ) {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id
         FROM workflows
        WHERE tenant_id = $1
          AND metadata->>'parent_workflow_id' = $2
          AND metadata->>'create_request_id' = $3
        LIMIT 1`,
      [identity.tenantId, sourceWorkflowId, requestId],
    );
    const workflowId = result.rows[0]?.id;
    if (!workflowId) {
      return null;
    }
    return this.workflowService.getWorkflow(identity.tenantId, workflowId);
  }

  private async linkChildWorkflow(
    tenantId: string,
    sourceWorkflowId: string,
    sourceWorkflow: Record<string, unknown>,
    childWorkflowId: string,
  ) {
    const sourceMetadata = asRecord(sourceWorkflow.metadata);
    const childWorkflowIds = dedupeChildWorkflowIds(sourceMetadata.child_workflow_ids, childWorkflowId);
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
      await this.workspaceTimelineService.recordWorkflowTerminalState(tenantId, sourceWorkflowId);
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

function dedupeChildWorkflowIds(value: unknown, childWorkflowId: string) {
  const unique = new Set<string>();
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string' && entry.length > 0) {
        unique.add(entry);
      }
    }
  }
  unique.add(childWorkflowId);
  return [...unique];
}

function isWorkflowCreateRequestConflict(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const pgError = error as { code?: string; constraint?: string };
  return pgError.code === '23505' && pgError.constraint === 'idx_workflows_parent_create_request';
}
