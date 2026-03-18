import type { DatabasePool } from '../db/database.js';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { AppEnv } from '../config/schema.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import type { StreamEvent } from './event-stream-service.js';
import type { IntegrationActionService } from './integration-action-service.js';
import type { PlatformTransportTimingDefaults } from './platform-timing-defaults.js';
import {
  deliverOtlpEvent,
  normalizeStoredOtlpConfig,
  toOtlpDeliveryTarget,
  toPublicOtlpConfig,
} from './integration-adapter-otlp.js';
import {
  deliverSlackEvent,
  normalizeStoredSlackConfig,
  toPublicSlackConfig,
  toSlackDeliveryTarget,
} from './integration-adapter-slack.js';
import {
  normalizeStoredGitHubIssuesConfig,
  syncGitHubIssue,
  toGitHubIssuesTarget,
  toPublicGitHubIssuesConfig,
  type GitHubIssueLink,
  type TaskIssueSnapshot,
} from './integration-adapter-github-issues.js';
import {
  deliverWebhookEvent,
  matchesSubscription,
  normalizeStoredWebhookConfig,
  readWorkflowId,
  toPublicWebhookConfig,
  toWebhookDeliveryTarget,
  type DeliveryAttempt,
} from './integration-adapter-webhook.js';
import { migrateStoredIntegrationHeaders } from './integration-adapter-headers.js';
import { encryptWebhookSecret, isWebhookSecretEncrypted } from './webhook-secret-crypto.js';

type IntegrationAdapterKind = 'webhook' | 'slack' | 'otlp_http' | 'github_issues';

interface IntegrationAdapterRow {
  id: string;
  tenant_id: string;
  workflow_id: string | null;
  kind: IntegrationAdapterKind;
  config: Record<string, unknown>;
  subscriptions: string[] | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface RegisterIntegrationAdapterInput {
  kind: IntegrationAdapterKind;
  workflow_id?: string;
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
    private readonly config: AppEnv & PlatformTransportTimingDefaults,
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
      `INSERT INTO integration_adapters (tenant_id, workflow_id, kind, config, subscriptions, is_active)
       VALUES ($1,$2,$3,$4::jsonb,$5,true)
       RETURNING *`,
      [
        identity.tenantId,
        input.workflow_id ?? null,
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
    const rows = await Promise.all(result.rows.map((row) => this.ensureStoredSecretsEncrypted(row)));
    return rows.map((row) => this.toPublicAdapter(row));
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
      await client.query(
        `DELETE FROM integration_resource_links
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
    const workflowId = readWorkflowId(event);
    const rows = await this.listActiveRows(event.tenant_id, workflowId);

    for (const row of rows) {
      if (!matchesSubscription(event.type, row.subscriptions ?? [])) {
        continue;
      }

      if (row.kind !== 'webhook' && row.kind !== 'slack' && row.kind !== 'otlp_http' && row.kind !== 'github_issues') {
        continue;
      }

      const deliveryId = await this.insertPendingDelivery(event.tenant_id, row.id, event.id);
      const payload = await this.buildEventPayload(event, workflowId, row.id);
      const attempt = await this.deliverByKind(row, event, payload);
      await this.finishDelivery(deliveryId, attempt);
    }
  }

  private async listActiveRows(tenantId: string, workflowId: string | null): Promise<IntegrationAdapterRow[]> {
    const result = await this.pool.query<IntegrationAdapterRow>(
      `SELECT *
         FROM integration_adapters
        WHERE tenant_id = $1
          AND is_active = true
          AND ($2::uuid IS NULL OR workflow_id IS NULL OR workflow_id = $2)
        ORDER BY created_at ASC`,
      [tenantId, workflowId],
    );
    return Promise.all(result.rows.map((row) => this.ensureStoredSecretsEncrypted(row)));
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
    workflowId: string | null,
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
      workflow_id: workflowId,
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

  private async deliverByKind(
    row: IntegrationAdapterRow,
    event: StreamEvent,
    payload: Record<string, unknown>,
  ): Promise<DeliveryAttempt> {
    if (row.kind === 'webhook') {
      return deliverWebhookEvent(
        this.fetchFn,
        this.config,
        toWebhookDeliveryTarget(row.config, this.config.WEBHOOK_ENCRYPTION_KEY),
        event.type,
        payload,
      );
    }

    if (row.kind === 'slack') {
      return deliverSlackEvent(
        this.fetchFn,
        this.config,
        toSlackDeliveryTarget(row.config, this.config.WEBHOOK_ENCRYPTION_KEY),
        payload,
      );
    }

    if (row.kind === 'otlp_http') {
      return deliverOtlpEvent(
        this.fetchFn,
        this.config,
        toOtlpDeliveryTarget(row.config, this.config.WEBHOOK_ENCRYPTION_KEY),
        event,
      );
    }

    return this.deliverGitHubIssueEvent(row, event);
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
      workflow_id: row.workflow_id,
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
    if (kind === 'otlp_http') {
      return toPublicOtlpConfig(config);
    }
    if (kind === 'github_issues') {
      return toPublicGitHubIssuesConfig(config);
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
    return this.ensureStoredSecretsEncrypted(result.rows[0]);
  }

  private async ensureStoredSecretsEncrypted(row: IntegrationAdapterRow): Promise<IntegrationAdapterRow> {
    const config = this.migrateLegacySecretConfig(row.kind, row.config);
    if (config === row.config) {
      return row;
    }

    await this.pool.query(
      `UPDATE integration_adapters
          SET config = $3::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [row.tenant_id, row.id, config],
    );

    return {
      ...row,
      config,
      updated_at: new Date(),
    };
  }

  private normalizeStoredConfig(kind: IntegrationAdapterKind, currentConfig: Record<string, unknown>, nextConfig: Record<string, unknown>) {
    if (kind === 'webhook') {
      return normalizeStoredWebhookConfig(currentConfig, nextConfig, this.config.WEBHOOK_ENCRYPTION_KEY);
    }
    if (kind === 'slack') {
      return normalizeStoredSlackConfig(currentConfig, nextConfig, this.config.WEBHOOK_ENCRYPTION_KEY);
    }
    if (kind === 'otlp_http') {
      return normalizeStoredOtlpConfig(currentConfig, nextConfig, this.config.WEBHOOK_ENCRYPTION_KEY);
    }
    if (kind === 'github_issues') {
      return normalizeStoredGitHubIssuesConfig(currentConfig, nextConfig, this.config.WEBHOOK_ENCRYPTION_KEY);
    }
    throw new ValidationError(`Unsupported integration adapter kind '${kind}'`);
  }

  private migrateLegacySecretConfig(kind: IntegrationAdapterKind, config: Record<string, unknown>) {
    if (kind === 'webhook') {
      return migrateLegacyWebhookConfig(config, this.config.WEBHOOK_ENCRYPTION_KEY);
    }
    if (kind === 'slack') {
      return migrateLegacySlackConfig(config, this.config.WEBHOOK_ENCRYPTION_KEY);
    }
    if (kind === 'otlp_http') {
      return migrateLegacyOtlpConfig(config, this.config.WEBHOOK_ENCRYPTION_KEY);
    }
    if (kind === 'github_issues') {
      return migrateLegacyGitHubIssuesConfig(config, this.config.WEBHOOK_ENCRYPTION_KEY);
    }
    return config;
  }

  private async deliverGitHubIssueEvent(
    row: IntegrationAdapterRow,
    event: StreamEvent,
  ): Promise<DeliveryAttempt> {
    if (event.entity_type !== 'task') {
      return { attempts: 1, delivered: true, lastStatusCode: 204, lastError: null };
    }

    const task = await this.loadTaskIssueSnapshot(event.tenant_id, event.entity_id);
    if (!task) {
      return { attempts: 1, delivered: false, lastStatusCode: null, lastError: 'Task not found' };
    }

    const existingLink = await this.loadIssueLink(event.tenant_id, row.id, event.entity_id);

    try {
      const issue = await syncGitHubIssue(
        this.fetchFn,
        toGitHubIssuesTarget(row.config, this.config.WEBHOOK_ENCRYPTION_KEY),
        task,
        existingLink,
      );
      await this.upsertIssueLink(event.tenant_id, row.id, event.entity_id, issue);
      return { attempts: 1, delivered: true, lastStatusCode: existingLink ? 200 : 201, lastError: null };
    } catch (error) {
      return {
        attempts: 1,
        delivered: false,
        lastStatusCode: null,
        lastError: error instanceof Error ? error.message : 'GitHub Issues delivery failed',
      };
    }
  }

  private async loadTaskIssueSnapshot(tenantId: string, taskId: string): Promise<TaskIssueSnapshot | null> {
    const result = await this.pool.query<{
      id: string;
      title: string;
      state: string;
      priority: string;
      workflow_id: string | null;
      input: Record<string, unknown> | null;
    }>(
      `SELECT id, title, state, priority, workflow_id, input
       FROM tasks
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, taskId],
    );

    if (!result.rowCount) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      title: row.title,
      state: row.state,
      priority: row.priority,
      workflowId: row.workflow_id,
      input: (row.input ?? {}) as Record<string, unknown>,
    };
  }

  private async loadIssueLink(tenantId: string, adapterId: string, taskId: string): Promise<GitHubIssueLink | null> {
    const result = await this.pool.query<{ external_id: string; external_url: string | null }>(
      `SELECT external_id, external_url
       FROM integration_resource_links
       WHERE tenant_id = $1
         AND adapter_id = $2
         AND entity_type = 'task'
         AND entity_id = $3`,
      [tenantId, adapterId, taskId],
    );

    if (!result.rowCount) {
      return null;
    }

    return {
      externalId: result.rows[0].external_id,
      externalUrl: result.rows[0].external_url,
    };
  }

  private async upsertIssueLink(
    tenantId: string,
    adapterId: string,
    taskId: string,
    issue: GitHubIssueLink,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO integration_resource_links (
         tenant_id,
         adapter_id,
         entity_type,
         entity_id,
         external_id,
         external_url,
         metadata
       )
       VALUES ($1, $2, 'task', $3, $4, $5, '{}'::jsonb)
       ON CONFLICT (tenant_id, adapter_id, entity_type, entity_id)
       DO UPDATE SET
         external_id = EXCLUDED.external_id,
         external_url = EXCLUDED.external_url,
         updated_at = now()`,
      [tenantId, adapterId, taskId, issue.externalId, issue.externalUrl],
    );
  }
}

function migrateLegacyWebhookConfig(config: Record<string, unknown>, encryptionKey: string) {
  const nextConfig = { ...config };
  let changed = false;

  if (typeof nextConfig.secret === 'string' && shouldEncryptStoredSecret(nextConfig.secret)) {
    nextConfig.secret = encryptWebhookSecret(nextConfig.secret, encryptionKey);
    changed = true;
  }

  const headers = readHeaderRecord(nextConfig.headers);
  const migratedHeaders = migrateStoredIntegrationHeaders(headers, encryptionKey);
  if (migratedHeaders.changed) {
    nextConfig.headers = migratedHeaders.headers;
    changed = true;
  }

  return changed ? nextConfig : config;
}

function migrateLegacySlackConfig(config: Record<string, unknown>, encryptionKey: string) {
  if (typeof config.webhook_url !== 'string' || !shouldEncryptStoredSecret(config.webhook_url)) {
    return config;
  }

  return {
    ...config,
    webhook_url: encryptWebhookSecret(config.webhook_url, encryptionKey),
  };
}

function migrateLegacyGitHubIssuesConfig(config: Record<string, unknown>, encryptionKey: string) {
  if (typeof config.token !== 'string' || !shouldEncryptStoredSecret(config.token)) {
    return config;
  }

  return {
    ...config,
    token: encryptWebhookSecret(config.token, encryptionKey),
  };
}

function migrateLegacyOtlpConfig(config: Record<string, unknown>, encryptionKey: string) {
  const headers = readHeaderRecord(config.headers);
  const migrated = migrateStoredIntegrationHeaders(headers, encryptionKey);
  if (!migrated.changed) {
    return config;
  }

  return {
    ...config,
    headers: migrated.headers,
  };
}

function readHeaderRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, headerValue]) => typeof headerValue === 'string'),
  ) as Record<string, string>;
}

function shouldEncryptStoredSecret(value: string): boolean {
  return value.length > 0 && !isWebhookSecretEncrypted(value) && !value.startsWith('secret:');
}
