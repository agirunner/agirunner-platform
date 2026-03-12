import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { ConflictError, NotFoundError } from '../errors/domain-errors.js';
import { EventService } from './event-service.js';
import { WorkflowStateService } from './workflow-state-service.js';

export class WorkflowControlService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
    private readonly stateService: WorkflowStateService,
  ) {}

  async pauseWorkflow(identity: ApiKeyIdentity, workflowId: string) {
    const result = await this.pool.query(
      `UPDATE workflows
       SET state = 'paused', updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND state IN ('pending', 'active')
       RETURNING *`,
      [identity.tenantId, workflowId],
    );

    if (!result.rowCount) {
      throw new ConflictError('Workflow is not pausable');
    }

    await this.eventService.emit({
      tenantId: identity.tenantId,
      type: 'workflow.paused',
      entityType: 'workflow',
      entityId: workflowId,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: {},
    });

    return result.rows[0];
  }

  async resumeWorkflow(identity: ApiKeyIdentity, workflowId: string) {
    const exists = await this.pool.query('SELECT id FROM workflows WHERE tenant_id = $1 AND id = $2', [
      identity.tenantId,
      workflowId,
    ]);
    if (!exists.rowCount) {
      throw new NotFoundError('Workflow not found');
    }

    const state = await this.stateService.recomputeWorkflowState(identity.tenantId, workflowId, undefined, {
      actorType: identity.scope,
      actorId: identity.keyPrefix,
    });

    await this.eventService.emit({
      tenantId: identity.tenantId,
      type: 'workflow.resumed',
      entityType: 'workflow',
      entityId: workflowId,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: { state },
    });

    return { id: workflowId, state };
  }
}
