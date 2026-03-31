import { isDeepStrictEqual } from 'node:util';

import type { DatabasePool } from '../../db/database.js';
import {
  decryptWebhookSecret,
  encryptWebhookSecret,
  isWebhookSecretEncrypted,
} from '../webhooks/webhook-secret-crypto.js';
import { normalizeWorkspaceSettings } from './workspace-settings.js';
import { normalizeRecord } from './workspace-records.js';
import type { GitWebhookProvider, WorkspaceRow } from './workspace-types.js';

export class WorkspaceSecretStore {
  constructor(
    private readonly pool: DatabasePool,
    private readonly encryptionKey: string,
  ) {}

  async ensureWorkspaceSecretsEncrypted(
    tenantId: string,
    workspace: WorkspaceRow,
  ): Promise<WorkspaceRow> {
    const withGitSettings = await this.ensureWorkspaceGitSettingsEncrypted(tenantId, workspace);
    return this.ensureGitWebhookSecretEncrypted(tenantId, withGitSettings);
  }

  async getGitWebhookSecret(
    tenantId: string,
    workspaceId: string,
  ): Promise<{ provider: GitWebhookProvider; secret: string } | null> {
    const result = await this.pool.query<{
      git_webhook_provider: GitWebhookProvider | null;
      git_webhook_secret: string | null;
    }>(
      'SELECT git_webhook_provider, git_webhook_secret FROM workspaces WHERE tenant_id = $1 AND id = $2',
      [tenantId, workspaceId],
    );
    if (!result.rowCount) {
      return null;
    }

    const row = result.rows[0];
    if (!row.git_webhook_provider || !row.git_webhook_secret) {
      return null;
    }

    const secret = await this.ensureWorkspaceWebhookSecretEncrypted(
      tenantId,
      workspaceId,
      row.git_webhook_secret,
    );
    return {
      provider: row.git_webhook_provider,
      secret: decryptWebhookSecret(secret, this.encryptionKey),
    };
  }

  async ensureWorkspaceWebhookSecretEncrypted(
    tenantId: string,
    workspaceId: string,
    secret: string,
  ): Promise<string> {
    if (isWebhookSecretEncrypted(secret)) {
      return secret;
    }

    const encryptedSecret = encryptWebhookSecret(secret, this.encryptionKey);
    await this.pool.query(
      `UPDATE workspaces
          SET git_webhook_secret = $3,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, workspaceId, encryptedSecret],
    );
    return encryptedSecret;
  }

  private async ensureWorkspaceGitSettingsEncrypted(
    tenantId: string,
    workspace: WorkspaceRow,
  ): Promise<WorkspaceRow> {
    const record = workspace as Record<string, unknown>;
    const settingsRecord = normalizeRecord(record.settings);
    const storedCredentials = normalizeRecord(settingsRecord.credentials);
    const storedGitToken = typeof storedCredentials.git_token === 'string'
      ? storedCredentials.git_token
      : typeof settingsRecord.git_token_secret_ref === 'string'
        ? settingsRecord.git_token_secret_ref
        : null;
    if (!storedGitToken) {
      return workspace;
    }

    const normalizedSettings = normalizeWorkspaceSettings(record.settings);
    const normalizedGitToken = normalizedSettings.credentials.git_token ?? null;
    const shouldRewriteSettings = !isDeepStrictEqual(record.settings, normalizedSettings);
    if ((!normalizedGitToken || normalizedGitToken === storedGitToken) && !shouldRewriteSettings) {
      return workspace;
    }

    await this.pool.query(
      `UPDATE workspaces
          SET settings = $3,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, String(record.id), normalizedSettings],
    );

    return {
      ...workspace,
      settings: normalizedSettings,
      updated_at: new Date(),
    };
  }

  private async ensureGitWebhookSecretEncrypted(
    tenantId: string,
    workspace: WorkspaceRow,
  ): Promise<WorkspaceRow> {
    const record = workspace as Record<string, unknown>;
    const secret =
      typeof record.git_webhook_secret === 'string' ? record.git_webhook_secret : null;
    if (!secret) {
      return workspace;
    }

    const encryptedSecret = await this.ensureWorkspaceWebhookSecretEncrypted(
      tenantId,
      String(record.id),
      secret,
    );
    if (encryptedSecret === secret) {
      return workspace;
    }

    return {
      ...workspace,
      git_webhook_secret: encryptedSecret,
      updated_at: new Date(),
    };
  }
}
