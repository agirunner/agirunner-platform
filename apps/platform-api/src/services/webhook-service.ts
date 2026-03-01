import type { DatabasePool } from '../db/database.js';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { AppEnv } from '../config/schema.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import type { StreamEvent } from './event-stream-service.js';
import { decryptWebhookSecret, encryptWebhookSecret, isWebhookSecretEncrypted } from './webhook-secret-crypto.js';
import { createWebhookSignature, generateWebhookSecret } from './webhook-delivery.js';

interface WebhookInput {
  url: string;
  event_types?: string[];
  secret?: string;
}

interface UpdateWebhookInput {
  url?: string;
  event_types?: string[];
  is_active?: boolean;
}

interface WebhookRow {
  id: string;
  url: string;
  secret: string;
  event_types: string[] | null;
}

function validateWebhookUrl(url: string): void {
  if (!/^https?:\/\//.test(url)) {
    throw new ValidationError('Webhook url must be http(s)');
  }
}

function matchesEvent(eventType: string, subscriptions: string[]): boolean {
  if (subscriptions.length === 0) {
    return true;
  }

  return subscriptions.some(
    (entry) => entry === eventType || (entry.endsWith('.*') && eventType.startsWith(`${entry.slice(0, -2)}.`)),
  );
}

export class WebhookService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly config: AppEnv,
  ) {}

  async migratePlaintextSecrets(): Promise<number> {
    const result = await this.pool.query<{ id: string; secret: string }>('SELECT id, secret FROM webhooks');

    let migratedCount = 0;
    for (const row of result.rows) {
      if (isWebhookSecretEncrypted(row.secret)) {
        continue;
      }

      const encryptedSecret = encryptWebhookSecret(row.secret, this.config.WEBHOOK_ENCRYPTION_KEY);
      await this.pool.query('UPDATE webhooks SET secret = $2 WHERE id = $1', [row.id, encryptedSecret]);
      migratedCount += 1;
    }

    return migratedCount;
  }

  async registerWebhook(identity: ApiKeyIdentity, input: WebhookInput) {
    validateWebhookUrl(input.url);

    const secret = input.secret ?? generateWebhookSecret();
    const encryptedSecret = encryptWebhookSecret(secret, this.config.WEBHOOK_ENCRYPTION_KEY);
    const result = await this.pool.query(
      `INSERT INTO webhooks (tenant_id, url, secret, event_types, is_active)
       VALUES ($1,$2,$3,$4,true)
       RETURNING id, url, event_types, is_active, created_at`,
      [identity.tenantId, input.url, encryptedSecret, input.event_types ?? []],
    );

    return { ...result.rows[0], secret };
  }

  async updateWebhook(tenantId: string, webhookId: string, input: UpdateWebhookInput) {
    if (input.url !== undefined) {
      validateWebhookUrl(input.url);
    }

    const result = await this.pool.query(
      `UPDATE webhooks
       SET url = COALESCE($3, url),
           event_types = COALESCE($4, event_types),
           is_active = COALESCE($5, is_active)
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, url, event_types, is_active, created_at`,
      [tenantId, webhookId, input.url ?? null, input.event_types ?? null, input.is_active ?? null],
    );

    if (!result.rowCount) {
      throw new NotFoundError('Webhook not found');
    }

    return result.rows[0];
  }

  async listWebhooks(tenantId: string) {
    const result = await this.pool.query(
      'SELECT id, url, event_types, is_active, created_at FROM webhooks WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId],
    );
    return result.rows;
  }

  async deleteWebhook(tenantId: string, webhookId: string) {
    const result = await this.pool.query('DELETE FROM webhooks WHERE tenant_id = $1 AND id = $2 RETURNING id', [tenantId, webhookId]);
    if (!result.rowCount) {
      throw new NotFoundError('Webhook not found');
    }
  }

  async deliverEvent(event: StreamEvent): Promise<void> {
    const hooks = await this.pool.query<WebhookRow>(
      'SELECT id, url, secret, event_types FROM webhooks WHERE tenant_id = $1 AND is_active = true',
      [event.tenant_id],
    );

    for (const hook of hooks.rows) {
      if (!matchesEvent(event.type, hook.event_types ?? [])) {
        continue;
      }

      const payload = JSON.stringify({
        id: event.id,
        type: event.type,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        data: event.data,
        created_at: event.created_at,
      });

      await this.pool.query(
        `INSERT INTO webhook_deliveries (tenant_id, webhook_id, event_id, event_type, attempts, status)
         VALUES ($1,$2,$3,$4,0,'pending')`,
        [event.tenant_id, hook.id, event.id, event.type],
      );

      let signingSecret: string;
      try {
        signingSecret = decryptWebhookSecret(hook.secret, this.config.WEBHOOK_ENCRYPTION_KEY);
      } catch (error) {
        await this.pool.query(
          `UPDATE webhook_deliveries
           SET attempts = 1,
               status = 'failed',
               last_status_code = NULL,
               last_error = $4,
               delivered_at = NULL
           WHERE tenant_id = $1 AND webhook_id = $2 AND event_id = $3 AND status = 'pending'`,
          [event.tenant_id, hook.id, event.id, `Webhook secret decryption failed: ${(error as Error).message}`],
        );
        continue;
      }

      let attempts = 0;
      let delivered = false;
      let lastStatusCode: number | null = null;
      let lastError: string | null = null;

      while (!delivered && attempts < this.config.WEBHOOK_MAX_ATTEMPTS) {
        attempts += 1;
        try {
          const response = await fetch(hook.url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-agentbaton-signature': createWebhookSignature(signingSecret, payload),
              'x-agentbaton-event': event.type,
            },
            body: payload,
          });

          lastStatusCode = response.status;
          if (response.ok) {
            delivered = true;
            break;
          }
          lastError = `HTTP ${response.status}`;
        } catch (error) {
          lastError = (error as Error).message;
        }

        const backoffMs = this.config.WEBHOOK_RETRY_BASE_DELAY_MS * 2 ** (attempts - 1);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }

      await this.pool.query(
        `UPDATE webhook_deliveries
         SET attempts = $4,
             status = $5,
             last_status_code = $6,
             last_error = $7,
             delivered_at = CASE WHEN $5 = 'delivered' THEN now() ELSE NULL END
         WHERE tenant_id = $1 AND webhook_id = $2 AND event_id = $3 AND status = 'pending'`,
        [event.tenant_id, hook.id, event.id, attempts, delivered ? 'delivered' : 'failed', lastStatusCode, lastError],
      );
    }
  }
}
