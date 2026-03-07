import { createHash, randomBytes } from 'node:crypto';

import type { DatabasePool } from '../db/database.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import type { TaskService } from './task-service.js';

type IntegrationActionType = 'approve' | 'reject' | 'request_changes' | 'skip';

interface IntegrationActionRow {
  id: string;
  tenant_id: string;
  adapter_id: string;
  task_id: string;
  action_type: IntegrationActionType;
  expires_at: Date;
  consumed_at: Date | null;
}

interface ExecuteIntegrationActionInput {
  feedback?: string;
  reason?: string;
  override_input?: Record<string, unknown>;
  preferred_agent_id?: string;
  preferred_worker_id?: string;
}

interface ExecuteIntegrationActionOptions {
  allowImplicitDefaults?: boolean;
}

export class IntegrationActionService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly taskService: TaskService,
    private readonly config: {
      PLATFORM_PUBLIC_BASE_URL: string;
      INTEGRATION_ACTION_TTL_SECONDS: number;
    },
  ) {}

  async buildApprovalActions(tenantId: string, adapterId: string, taskId: string) {
    const actions = await Promise.all(
      (['approve', 'reject', 'request_changes', 'skip'] as const).map((actionType) =>
        this.createActionLink(tenantId, adapterId, taskId, actionType),
      ),
    );

    return Object.fromEntries(actions.map((action) => [action.action, action])) as Record<
      string,
      {
        action: IntegrationActionType;
        method: 'POST';
        url: string;
        feedback_required: boolean;
      }
    >;
  }

  async executeAction(
    token: string,
    input: ExecuteIntegrationActionInput = {},
    options: ExecuteIntegrationActionOptions = {},
  ) {
    const row = await this.loadPendingAction(token);
    const identity = this.createIntegrationIdentity(row.tenant_id, row.adapter_id);

    const task =
      row.action_type === 'approve'
        ? await this.taskService.approveTask(identity, row.task_id)
        : row.action_type === 'reject'
          ? await this.taskService.rejectTask(identity, row.task_id, {
              feedback: this.requireFeedback(input.feedback, 'reject', options.allowImplicitDefaults),
            })
          : row.action_type === 'request_changes'
            ? await this.taskService.requestTaskChanges(identity, row.task_id, {
                feedback: this.requireFeedback(
                  input.feedback,
                  'request_changes',
                  options.allowImplicitDefaults,
                ),
                override_input: input.override_input,
                preferred_agent_id: input.preferred_agent_id,
                preferred_worker_id: input.preferred_worker_id,
              })
            : await this.taskService.skipTask(identity, row.task_id, {
                reason: this.requireReason(input.reason, options.allowImplicitDefaults),
              });

    await this.pool.query(
      'UPDATE integration_actions SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL',
      [row.id],
    );

    return task;
  }

  private async createActionLink(
    tenantId: string,
    adapterId: string,
    taskId: string,
    actionType: IntegrationActionType,
  ) {
    const token = randomBytes(24).toString('hex');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + this.config.INTEGRATION_ACTION_TTL_SECONDS * 1000);

    await this.pool.query(
      `INSERT INTO integration_actions (tenant_id, adapter_id, task_id, action_type, token_hash, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tenantId, adapterId, taskId, actionType, tokenHash, expiresAt],
    );

    return {
      action: actionType,
      method: 'POST' as const,
      url: `${this.config.PLATFORM_PUBLIC_BASE_URL}/api/v1/integrations/actions/${token}`,
      feedback_required: actionType === 'reject' || actionType === 'request_changes' || actionType === 'skip',
    };
  }

  private async loadPendingAction(token: string): Promise<IntegrationActionRow> {
    const tokenHash = this.hashToken(token);
    const result = await this.pool.query<IntegrationActionRow>(
      `SELECT *
         FROM integration_actions
        WHERE token_hash = $1
          AND consumed_at IS NULL
          AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 1`,
      [tokenHash],
    );

    if (!result.rowCount) {
      throw new NotFoundError('Integration action not found');
    }

    return result.rows[0];
  }

  private createIntegrationIdentity(tenantId: string, adapterId: string) {
    return {
      id: `integration:${adapterId}`,
      tenantId,
      scope: 'admin' as const,
      ownerType: 'integration_adapter',
      ownerId: adapterId,
      keyPrefix: `integration:${adapterId}`,
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private requireFeedback(
    feedback: string | undefined,
    actionType: 'reject' | 'request_changes',
    allowImplicitDefaults = false,
  ): string {
    if (allowImplicitDefaults && (!feedback || feedback.trim().length === 0)) {
      return actionType === 'reject'
        ? 'Rejected by integration callback'
        : 'Changes requested by integration callback';
    }

    if (!feedback || feedback.trim().length === 0) {
      throw new ValidationError(`${actionType} integration actions require feedback`);
    }
    return feedback;
  }

  private requireReason(reason: string | undefined, allowImplicitDefaults = false): string {
    if (allowImplicitDefaults && (!reason || reason.trim().length === 0)) {
      return 'Skipped by integration callback';
    }

    if (!reason || reason.trim().length === 0) {
      throw new ValidationError('skip integration actions require a reason');
    }
    return reason;
  }
}
