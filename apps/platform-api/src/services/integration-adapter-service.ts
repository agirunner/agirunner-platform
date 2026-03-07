import type { DatabasePool } from '../db/database.js';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { AppEnv } from '../config/schema.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import type { StreamEvent } from './event-stream-service.js';
import type { IntegrationActionService } from './integration-action-service.js';
import {
  deliverSlackEvent,
  normalizeStoredSlackConfig,
  toPublicSlackConfig,
  toSlackDeliveryTarget,
} from './integration-adapter-slack.js';
import {
  deliverWebhookEvent,
  matchesSubscription,
  normalizeStoredWebhookConfig,
  readPipelineId,
  toPublicWebhookConfig,
  toWebhookDeliveryTarget,
  type DeliveryAttempt,
} from './integration-adapter-webhook.js';

type IntegrationAdapterKind = 'webhook' | 'slack';

interface IntegrationAdapterRow {
  id: string;
  tenant_id: string;
  pipeline_id: string | null;
  kind: IntegrationAdapterKind;
  config: Record<string, unknown>;
  subscriptions: string[] | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface RegisterIntegrationAdapterInput {
  kind: IntegrationAdapterKind;
  pipeline_id?: string;
  subscriptions?: string[];
  config: Record<string, unknown>;
}

interface UpdateIntegrationAdapterInput {
  subscriptions?: string[];
  is_active?: boolean;
  config?: Record<string, unknown>;
}

export class IntegrationAdapterService {
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(
    private readonly pool: DatabasePool,
    private readonly config: AppEnv,
    fetchFn?: typeof globalThis.fetch,
    private readonly integrationActionService?: Pick<
      IntegrationActionService,
      'buildApprovalActions'
    >,
  ) {
    this.fetchFn = fetchFn ?? globalThis.fetch;
  }

  async registerAdapter(identity: ApiKeyIdentity, input: RegisterIntegrationAdapterInput) {
    const config = this.normalizeStoredConfig(input.kind, {}, input.config);
    const result = await this.pool.query<IntegrationAdapterRow>(
      `INSERT INTO integration_adapters (tenant_id, pipeline_id, kind, config, subscriptions, is_active)
       VALUES ($1,$2,$3,$4::jsonb,$5,true)
       RETURNING *`,
      [
        identity.tenantId,
        input.pipeline_id ?? null,
        input.kind,
        config,
        input.subscriptions ?? [],
      ],
    );

    return this.toPublicAdapter(result.rows[0]);
  }

  async updateAdapter(tenantId: string, adapterId: string, input: UpdateIntegrationAdapterInput) {
    const current = await this.loadAdapterRow(tenantId, adapterId);
    const config =
      input.config !== undefined
        ? this.normalizeStoredConfig(current.kind, current.config, input.config)
        : current.config;

    const result = await this.pool.query<IntegrationAdapterRow>(
      `UPDATE integration_adapters
          SET config = $3::jsonb,
              subscriptions = COALESCE($4, subscriptions),
              is_active = COALESCE($5, is_active)
        WHERE tenant_id = $1
          AND id = $2
        RETURNING *`,
      [tenantId, adapterId, config, input.subscriptions ?? null, input.is_active ?? null],
    );

    return this.toPublicAdapter(result.rows[0]);
  }

  async listAdapters(tenantId: string) {
    const result = await this.pool.query<IntegrationAdapterRow>(
      'SELECT * FROM integration_adapters WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId],
    );
    return result.rows.map((row) => this.toPublicAdapter(row));
  }

  async deleteAdapter(tenantId: string, adapterId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM integration_actions
          WHERE tenant_id = $1
            AND adapter_id = $2`,
        [tenantId, adapterId],
      );
      await client.query(
        `DELETE FROM integration_adapter_deliveries
          WHERE tenant_id = $1
            AND adapter_id = $2`,
        [tenantId, adapterId],
      );
      const result = await client.query(
        'DELETE FROM integration_adapters WHERE tenant_id = $1 AND id = $2 RETURNING id',
        [tenantId, adapterId],
      );
      if (!result.rowCount) {
        throw new NotFoundError('Integration adapter not found');
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deliverEvent(event: StreamEvent): Promise<void> {
    const pipelineId = readPipelineId(event);
    const rows = await this.listActiveRows(event.tenant_id, pipelineId);

    for (const row of rows) {
      if (!matchesSubscription(event.type, row.subscriptions ?? [])) {
        continue;
      }

      if (row.kind !== 'webhook') {
        if (row.kind !== 'slack') {
          continue;
        }
      }

      const deliveryId = await this.insertPendingDelivery(event.tenant_id, row.id, event.id);
      const payload = await this.buildEventPayload(event, pipelineId, row.id);
      const attempt =
        row.kind === 'webhook'
          ? await deliverWebhookEvent(
              this.fetchFn,
              this.config,
              toWebhookDeliveryTarget(row.config, this.config.WEBHOOK_ENCRYPTION_KEY),
              event.type,
              payload,
            )
          : await deliverSlackEvent(
              this.fetchFn,
              this.config,
              toSlackDeliveryTarget(row.config),
              payload,
            );
      await this.finishDelivery(deliveryId, attempt);
    }
  }

  private async listActiveRows(tenantId: string, pipelineId: string | null): Promise<IntegrationAdapterRow[]> {
    const result = await this.pool.query<IntegrationAdapterRow>(
      `SELECT *
         FROM integration_adapters
        WHERE tenant_id = $1
          AND is_active = true
          AND ($2::uuid IS NULL OR pipeline_id IS NULL OR pipeline_id = $2)
        ORDER BY created_at ASC`,
      [tenantId, pipelineId],
    );
    return result.rows;
  }

  private async insertPendingDelivery(tenantId: string, adapterId: string, eventId: number): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO integration_adapter_deliveries (tenant_id, adapter_id, event_id, status, attempts)
       VALUES ($1,$2,$3,'pending',0)
       RETURNING id`,
      [tenantId, adapterId, eventId],
    );
    return result.rows[0].id;
  }

  private async finishDelivery(deliveryId: string, attempt: DeliveryAttempt): Promise<void> {
    await this.pool.query(
      `UPDATE integration_adapter_deliveries
          SET attempts = $2,
              status = $3,
              last_status_code = $4,
              last_error = $5,
              delivered_at = CASE WHEN $3 = 'delivered' THEN now() ELSE NULL END
        WHERE id = $1`,
      [
        deliveryId,
        attempt.attempts,
        attempt.delivered ? 'delivered' : 'failed',
        attempt.lastStatusCode,
        attempt.lastError,
      ],
    );
  }

  private async buildEventPayload(
    event: StreamEvent,
    pipelineId: string | null,
    adapterId: string,
  ): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = {
      id: event.id,
      tenant_id: event.tenant_id,
      type: event.type,
      entity_type: event.entity_type,
      entity_id: event.entity_id,
      data: event.data,
      created_at: event.created_at,
      pipeline_id: pipelineId,
    };

    if (this.shouldAttachApprovalActions(event)) {
      payload.approval_actions = await this.integrationActionService?.buildApprovalActions(
        event.tenant_id,
        adapterId,
        event.entity_id,
      );
    }

    return payload;
  }

  private shouldAttachApprovalActions(event: StreamEvent): boolean {
    if (!this.integrationActionService) {
      return false;
    }

    return (
      event.type === 'task.state_changed' &&
      event.entity_type === 'task' &&
      event.data?.to_state === 'awaiting_approval'
    );
  }

  private toPublicAdapter(row: IntegrationAdapterRow) {
    return {
      id: row.id,
      pipeline_id: row.pipeline_id,
      kind: row.kind,
      subscriptions: row.subscriptions ?? [],
      is_active: row.is_active,
      config: this.toPublicConfig(row.kind, row.config),
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  private toPublicConfig(kind: IntegrationAdapterKind, config: Record<string, unknown>) {
    if (kind === 'webhook') {
      return toPublicWebhookConfig(config);
    }
    if (kind === 'slack') {
      return toPublicSlackConfig(config);
    }
    throw new ValidationError(`Unsupported integration adapter kind '${kind}'`);
  }

  private async loadAdapterRow(tenantId: string, adapterId: string): Promise<IntegrationAdapterRow> {
    const result = await this.pool.query<IntegrationAdapterRow>(
      'SELECT * FROM integration_adapters WHERE tenant_id = $1 AND id = $2',
      [tenantId, adapterId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Integration adapter not found');
    }
    return result.rows[0];
  }

  private normalizeStoredConfig(kind: IntegrationAdapterKind, currentConfig: Record<string, unknown>, nextConfig: Record<string, unknown>) {
    if (kind === 'webhook') {
      return normalizeStoredWebhookConfig(currentConfig, nextConfig, this.config.WEBHOOK_ENCRYPTION_KEY);
    }
    if (kind === 'slack') {
      return normalizeStoredSlackConfig(currentConfig, nextConfig);
    }
    throw new ValidationError(`Unsupported integration adapter kind '${kind}'`);
  }
}
