import { isDeepStrictEqual } from 'node:util';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { AppEnv } from '../config/schema.js';
import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { TenantScopedRepository, type TenantRow } from '../db/tenant-scoped-repository.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import {
  DestructiveDeleteService,
  type DeleteImpactSummary,
} from './destructive-delete-service.js';
import { EventService } from './event-service.js';
import type { WorkspaceMemoryMutationContext } from './workspace-memory-scope-service.js';
import {
  normalizeWorkspaceSettings,
  parseWorkspaceSettingsInput,
  serializeWorkspaceSettings,
  type StoredWorkspaceSettings,
} from './workspace-settings.js';
import { resolveWorkspaceStorageBinding } from './workspace-storage.js';
import { sanitizeSecretLikeRecord } from './secret-redaction.js';
import { encryptWebhookSecret, decryptWebhookSecret, isWebhookSecretEncrypted } from './webhook-secret-crypto.js';
import { isExternalSecretReference, readProviderSecret } from '../lib/oauth-crypto.js';
import {
  WorkspaceGitAccessVerifier,
  type VerifyWorkspaceGitAccessResult,
} from './workspace-git-access-verifier.js';

interface WorkspaceListQuery {
  page: number;
  per_page: number;
  q?: string;
  is_active?: boolean;
}

interface CreateWorkspaceInput {
  name: string;
  slug: string;
  description?: string;
  repository_url?: string;
  settings?: Record<string, unknown> | StoredWorkspaceSettings;
  memory?: Record<string, unknown>;
}

interface UpdateWorkspaceInput {
  name?: string;
  slug?: string;
  description?: string;
  repository_url?: string;
  settings?: Record<string, unknown> | StoredWorkspaceSettings;
  is_active?: boolean;
}

interface VerifyWorkspaceGitAccessInput {
  repository_url: string;
  default_branch?: string;
  git_token_mode: 'preserve' | 'replace' | 'clear';
  git_token?: string;
}

interface WorkspaceMemoryPatch {
  key: string;
  value?: unknown;
  context?: WorkspaceMemoryMutationContext;
}

interface WorkspaceListSummary {
  active_workflow_count: number;
  completed_workflow_count: number;
  attention_workflow_count: number;
  total_workflow_count: number;
  last_workflow_activity_at: string | null;
}

interface WorkspaceWorkflowSummaryRow {
  workspace_id: string;
  active_workflow_count: number;
  completed_workflow_count: number;
  attention_workflow_count: number;
  total_workflow_count: number;
  last_workflow_activity_at: string | null;
}

type WorkspaceRow = TenantRow & Record<string, unknown>;
const WORKSPACE_MEMORY_SECRET_REDACTION = 'redacted://workspace-memory-secret';
const WORKSPACE_SETTINGS_SECRET_REDACTION = 'redacted://workspace-settings-secret';

function byteLengthJson(value: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function sanitizeMemoryEventValue(key: string, value: unknown): unknown {
  return sanitizeSecretLikeRecord(
    { [key]: value },
    { redactionValue: WORKSPACE_MEMORY_SECRET_REDACTION, allowSecretReferences: false },
  )[key];
}

function sanitizeWorkspaceRecordValue(key: string, value: unknown, redactionValue: string): unknown {
  return sanitizeSecretLikeRecord(
    { [key]: value },
    { redactionValue, allowSecretReferences: false },
  )[key];
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  if (code !== '23505') {
    return false;
  }

  const violatedConstraint =
    'constraint' in error ? String((error as { constraint?: unknown }).constraint ?? '') : '';
  return violatedConstraint === constraint;
}

type GitWebhookProvider = 'github' | 'gitea' | 'gitlab';

interface GitWebhookConfig {
  provider: GitWebhookProvider;
  secret: string;
}

export class WorkspaceService {
  private readonly encryptionKey: string;
  private readonly destructiveDeleteService: Pick<
    DestructiveDeleteService,
    'getWorkspaceDeleteImpact' | 'deleteWorkspaceCascading' | 'deleteWorkspaceWithoutDependencies'
  >;
  private readonly workspaceGitAccessVerifier: Pick<WorkspaceGitAccessVerifier, 'verify'>;

  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
    config?: Partial<
      Pick<
        AppEnv,
        'WEBHOOK_ENCRYPTION_KEY' | 'WORKSPACE_GIT_VERIFY_TIMEOUT_SECONDS' | 'WORKSPACE_GIT_VERIFY_USERNAME'
      >
    >,
    deps?: {
      destructiveDeleteService?: Pick<
        DestructiveDeleteService,
        'getWorkspaceDeleteImpact' | 'deleteWorkspaceCascading' | 'deleteWorkspaceWithoutDependencies'
      >;
      workspaceGitAccessVerifier?: Pick<WorkspaceGitAccessVerifier, 'verify'>;
    },
  ) {
    this.encryptionKey = config?.WEBHOOK_ENCRYPTION_KEY ?? '';
    this.destructiveDeleteService =
      deps?.destructiveDeleteService ?? new DestructiveDeleteService(pool);
    this.workspaceGitAccessVerifier = deps?.workspaceGitAccessVerifier
      ?? new WorkspaceGitAccessVerifier({
        timeoutSeconds: config?.WORKSPACE_GIT_VERIFY_TIMEOUT_SECONDS,
        credentialUsername: config?.WORKSPACE_GIT_VERIFY_USERNAME,
      });
  }

  async createWorkspace(identity: ApiKeyIdentity, input: CreateWorkspaceInput) {
    const memory = sanitizeMemoryForPersistence(normalizeRecord(input.memory));
    const memorySizeBytes = byteLengthJson(memory);
    const settings = parseWorkspaceSettingsInput(input.settings);
    const storage = resolveWorkspaceStorageBinding({
      repository_url: input.repository_url,
      settings,
    });
    if (storage.type === 'git_remote' && !storage.repository_url) {
      throw new ValidationError('Git Remote workspace storage requires a repository URL');
    }

    try {
      const result = await this.pool.query<Record<string, unknown>>(
        `INSERT INTO workspaces (
          tenant_id, name, slug, description, repository_url, settings, memory, memory_size_bytes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *`,
        [
          identity.tenantId,
          input.name,
          input.slug,
          input.description ?? null,
          storage.type === 'git_remote' ? storage.repository_url : null,
          settings,
          memory,
          memorySizeBytes,
        ],
      );

      const workspace = result.rows[0] as WorkspaceRow;
      await this.eventService.emit({
        tenantId: identity.tenantId,
        type: 'workspace.created',
        entityType: 'workspace',
        entityId: workspace.id as string,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: { slug: workspace.slug },
      });

      return redactWorkspaceSecrets(workspace);
    } catch (error) {
      if (isUniqueViolation(error, 'uq_workspace_tenant_slug')) {
        throw new ConflictError('Workspace slug already exists');
      }
      throw error;
    }
  }

  async listWorkspaces(tenantId: string, query: WorkspaceListQuery) {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (query.q) {
      values.push(`%${query.q}%`);
      conditions.push(`(name ILIKE $${values.length + 1} OR slug ILIKE $${values.length + 1})`);
    }

    if (typeof query.is_active === 'boolean') {
      values.push(query.is_active);
      conditions.push(`is_active = $${values.length + 1}`);
    }

    const offset = (query.page - 1) * query.per_page;

    const [total, rows] = await Promise.all([
      repo.count('workspaces', conditions, values),
      repo.findAllPaginated<WorkspaceRow>(
        'workspaces',
        '*',
        conditions,
        values,
        'created_at DESC',
        query.per_page,
        offset,
      ),
    ]);

    const migratedRows = await Promise.all(rows.map((row) => this.ensureWorkspaceSecretsEncrypted(tenantId, row)));
    const workflowSummaryByWorkspaceId = await this.loadWorkspaceWorkflowSummaries(
      tenantId,
      migratedRows.map((row) => String(row.id)),
    );

    return {
      data: migratedRows.map((row) => ({
        ...redactWorkspaceSecrets(row),
        summary: workflowSummaryByWorkspaceId.get(String(row.id)) ?? emptyWorkspaceListSummary(),
      })),
      meta: {
        total,
        page: query.page,
        per_page: query.per_page,
        pages: Math.ceil(total / query.per_page) || 1,
      },
    };
  }

  async getWorkspace(tenantId: string, workspaceId: string) {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const workspace = await repo.findById<WorkspaceRow>('workspaces', '*', workspaceId);
    if (!workspace) {
      throw new NotFoundError('Workspace not found');
    }
    return redactWorkspaceSecrets(await this.ensureWorkspaceSecretsEncrypted(tenantId, workspace));
  }

  async updateWorkspace(identity: ApiKeyIdentity, workspaceId: string, input: UpdateWorkspaceInput) {
    const existing = await this.loadWorkspaceRecord(identity.tenantId, workspaceId);
    const existingSettings = normalizeWorkspaceSettings(existing.settings);
    const settings =
      input.settings !== undefined
        ? parseWorkspaceSettingsInput(input.settings, existingSettings)
        : existingSettings;
    const storage = resolveWorkspaceStorageBinding({
      repository_url: input.repository_url ?? existing.repository_url,
      settings,
    });
    if (storage.type === 'git_remote' && !storage.repository_url) {
      throw new ValidationError('Git Remote workspace storage requires a repository URL');
    }

    try {
      const result = await this.pool.query<Record<string, unknown>>(
        `UPDATE workspaces
         SET name = COALESCE($3, name),
             slug = COALESCE($4, slug),
             description = COALESCE($5, description),
             repository_url = $6,
             settings = $7,
             is_active = COALESCE($8, is_active),
             updated_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [
          identity.tenantId,
          workspaceId,
          input.name ?? null,
          input.slug ?? null,
          input.description ?? null,
          storage.type === 'git_remote' ? storage.repository_url : null,
          settings,
          input.is_active ?? null,
        ],
      );

      if (!result.rowCount) {
        throw new NotFoundError('Workspace not found');
      }

      const workspace = result.rows[0] as WorkspaceRow;
      await this.eventService.emit({
        tenantId: identity.tenantId,
        type: 'workspace.updated',
        entityType: 'workspace',
        entityId: workspaceId,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: {
          name: workspace.name,
          slug: workspace.slug,
          is_active: workspace.is_active,
        },
      });

      return redactWorkspaceSecrets(workspace);
    } catch (error) {
      if (isUniqueViolation(error, 'uq_workspace_tenant_slug')) {
        throw new ConflictError('Workspace slug already exists');
      }
      throw error;
    }
  }

  async patchWorkspaceMemory(
    identity: ApiKeyIdentity,
    workspaceId: string,
    patch: WorkspaceMemoryPatch,
    client?: DatabaseClient,
  ) {
    return this.patchWorkspaceMemoryEntries(identity, workspaceId, [patch], client);
  }

  async patchWorkspaceMemoryEntries(
    identity: ApiKeyIdentity,
    workspaceId: string,
    patches: WorkspaceMemoryPatch[],
    client?: DatabaseClient,
  ) {
    if (patches.length === 0) {
      throw new ValidationError('Workspace memory updates cannot be empty');
    }

    const ownsTransaction = !client;
    const db = client ?? (await this.pool.connect());

    try {
      if (ownsTransaction) {
        await db.query('BEGIN');
      }

      let workspace = await this.loadWorkspaceForMemoryMutation(identity.tenantId, workspaceId, db);
      let currentMemory = normalizeRecord(workspace.memory);

      for (const patch of patches) {
        if (!patch.key || patch.key.length > 256) {
          throw new ValidationError('Workspace memory key must be between 1 and 256 characters');
        }

        const sanitizedValue = sanitizeMemoryValueForPersistence(patch.key, patch.value);
        const nextMemory = {
          ...currentMemory,
          [patch.key]: sanitizedValue,
        };
        const memoryMaxBytes = Number(workspace.memory_max_bytes ?? 1_048_576);
        const memorySizeBytes = byteLengthJson(nextMemory);

        if (memorySizeBytes > memoryMaxBytes) {
          throw new ValidationError('Workspace memory patch exceeds memory_max_bytes', {
            memory_size_bytes: memorySizeBytes,
            memory_max_bytes: memoryMaxBytes,
            key: patch.key,
          });
        }

        const result = await db.query<Record<string, unknown>>(
          `UPDATE workspaces
           SET memory = $3,
               memory_size_bytes = $4,
               updated_at = now()
           WHERE tenant_id = $1 AND id = $2
           RETURNING *`,
          [identity.tenantId, workspaceId, nextMemory, memorySizeBytes],
        );

        workspace = result.rows[0] as WorkspaceRow;
        currentMemory = normalizeRecord(workspace.memory);

        await this.eventService.emit(
          {
            tenantId: identity.tenantId,
            type: 'workspace.memory_updated',
            entityType: 'workspace',
            entityId: workspaceId,
            actorType: identity.scope,
            actorId: identity.keyPrefix,
            data: {
              key: patch.key,
              value: sanitizeMemoryEventValue(patch.key, patch.value),
              workspace_id: workspaceId,
              workflow_id: patch.context?.workflow_id ?? null,
              work_item_id: patch.context?.work_item_id ?? null,
              task_id: patch.context?.task_id ?? null,
              stage_name: patch.context?.stage_name ?? null,
              memory_size_bytes: memorySizeBytes,
            },
          },
          db,
        );
      }

      if (ownsTransaction) {
        await db.query('COMMIT');
      }

      return redactWorkspaceSecrets(workspace);
    } catch (error) {
      if (ownsTransaction) {
        await db.query('ROLLBACK');
      }
      throw error;
    } finally {
      if (ownsTransaction) {
        db.release();
      }
    }
  }

  async removeWorkspaceMemory(
    identity: ApiKeyIdentity,
    workspaceId: string,
    key: string,
    client?: DatabaseClient,
    context?: WorkspaceMemoryMutationContext,
  ) {
    const workspace = await this.getWorkspace(identity.tenantId, workspaceId);
    const currentMemory = normalizeRecord(workspace.memory);
    if (!(key in currentMemory)) {
      return workspace;
    }

    const nextMemory = { ...currentMemory };
    delete nextMemory[key];
    const memorySizeBytes = byteLengthJson(nextMemory);

    const db = client ?? this.pool;
    const result = await db.query<Record<string, unknown>>(
      `UPDATE workspaces
       SET memory = $3,
           memory_size_bytes = $4,
           updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [identity.tenantId, workspaceId, nextMemory, memorySizeBytes],
    );

    const updatedWorkspace = result.rows[0] as WorkspaceRow;
    await this.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'workspace.memory_deleted',
        entityType: 'workspace',
        entityId: workspaceId,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: {
          key,
          deleted_value: sanitizeMemoryEventValue(key, currentMemory[key]),
          workspace_id: workspaceId,
          workflow_id: context?.workflow_id ?? null,
          work_item_id: context?.work_item_id ?? null,
          task_id: context?.task_id ?? null,
          stage_name: context?.stage_name ?? null,
          memory_size_bytes: memorySizeBytes,
        },
      },
      client,
    );

    return redactWorkspaceSecrets(updatedWorkspace);
  }

  getWorkspaceDeleteImpact(
    identity: ApiKeyIdentity,
    workspaceId: string,
  ): Promise<DeleteImpactSummary> {
    return this.destructiveDeleteService.getWorkspaceDeleteImpact(identity.tenantId, workspaceId);
  }

  async deleteWorkspace(
    identity: ApiKeyIdentity,
    workspaceId: string,
    options?: { cascade?: boolean },
  ) {
    if (options?.cascade) {
      const result = await this.destructiveDeleteService.deleteWorkspaceCascading(
        identity,
        workspaceId,
      );
      await this.eventService.emit({
        tenantId: identity.tenantId,
        type: 'workspace.deleted',
        entityType: 'workspace',
        entityId: workspaceId,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: { cascade: true },
      });
      return result;
    }

    const impact = await this.destructiveDeleteService.getWorkspaceDeleteImpact(
      identity.tenantId,
      workspaceId,
    );
    if (impact.workflows > 0 || impact.tasks > 0) {
      throw new ConflictError('Workspace cannot be deleted while workflows or tasks reference it');
    }

    const result = await this.destructiveDeleteService.deleteWorkspaceWithoutDependencies(
      identity,
      workspaceId,
    );

    await this.eventService.emit({
      tenantId: identity.tenantId,
      type: 'workspace.deleted',
      entityType: 'workspace',
      entityId: workspaceId,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: {},
    });

    return result;
  }

  async setGitWebhookConfig(
    identity: ApiKeyIdentity,
    workspaceId: string,
    input: GitWebhookConfig,
  ) {
    await this.getWorkspace(identity.tenantId, workspaceId);

    const encryptedSecret = encryptWebhookSecret(input.secret, this.encryptionKey);
    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE workspaces
       SET git_webhook_provider = $3,
           git_webhook_secret = $4,
           updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, name, slug, git_webhook_provider, is_active, updated_at`,
      [identity.tenantId, workspaceId, input.provider, encryptedSecret],
    );

    await this.eventService.emit({
      tenantId: identity.tenantId,
      type: 'workspace.git_webhook_configured',
      entityType: 'workspace',
      entityId: workspaceId,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: { provider: input.provider },
    });

    const row = result.rows[0];
    return {
      ...row,
      git_webhook_secret_configured: true,
    };
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

  async findWorkspaceByRepositoryUrl(
    repositoryUrl: string,
  ): Promise<{ id: string; tenant_id: string } | null> {
    const normalized = normalizeRepoUrl(repositoryUrl);
    const result = await this.pool.query<{ id: string; tenant_id: string }>(
      `SELECT id, tenant_id FROM workspaces
       WHERE LOWER(REPLACE(REPLACE(repository_url, '.git', ''), 'http://', 'https://')) = $1
         AND is_active = true
       LIMIT 1`,
      [normalized],
    );

    return result.rowCount ? result.rows[0] : null;
  }

  async getWorkspaceModelOverride(
    tenantId: string,
    workspaceId: string,
  ): Promise<null> {
    await this.getWorkspace(tenantId, workspaceId);
    return null;
  }

  async verifyWorkspaceGitAccess(
    identity: ApiKeyIdentity,
    workspaceId: string,
    input: VerifyWorkspaceGitAccessInput,
  ): Promise<VerifyWorkspaceGitAccessResult> {
    const workspace = await this.loadWorkspaceRecord(identity.tenantId, workspaceId);
    const repositoryUrl = input.repository_url.trim();
    if (!repositoryUrl) {
      throw new ValidationError('Repository URL is required for Git access verification.');
    }

    const gitToken = resolveWorkspaceGitVerificationToken(workspace, input);
    return this.workspaceGitAccessVerifier.verify({
      repositoryUrl,
      defaultBranch: input.default_branch?.trim() || null,
      gitToken,
    });
  }

  private async ensureWorkspaceSecretsEncrypted(tenantId: string, workspace: WorkspaceRow): Promise<WorkspaceRow> {
    const withGitSettings = await this.ensureWorkspaceGitSettingsEncrypted(tenantId, workspace);
    return this.ensureGitWebhookSecretEncrypted(tenantId, withGitSettings);
  }

  private async ensureWorkspaceGitSettingsEncrypted(tenantId: string, workspace: WorkspaceRow): Promise<WorkspaceRow> {
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

  private async ensureGitWebhookSecretEncrypted(tenantId: string, workspace: WorkspaceRow): Promise<WorkspaceRow> {
    const record = workspace as Record<string, unknown>;
    const secret = typeof record.git_webhook_secret === 'string' ? record.git_webhook_secret : null;
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

  private async ensureWorkspaceWebhookSecretEncrypted(
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

  private async loadWorkspaceForMemoryMutation(
    tenantId: string,
    workspaceId: string,
    client: DatabaseClient,
  ): Promise<WorkspaceRow> {
    const result = await client.query<Record<string, unknown>>(
      `SELECT *
         FROM workspaces
        WHERE tenant_id = $1
          AND id = $2
        FOR UPDATE`,
      [tenantId, workspaceId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workspace not found');
    }
    return result.rows[0] as WorkspaceRow;
  }

  private async loadWorkspaceRecord(tenantId: string, workspaceId: string): Promise<WorkspaceRow> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const workspace = await repo.findById<WorkspaceRow>('workspaces', '*', workspaceId);
    if (!workspace) {
      throw new NotFoundError('Workspace not found');
    }
    return this.ensureWorkspaceSecretsEncrypted(tenantId, workspace);
  }

  private async loadWorkspaceWorkflowSummaries(
    tenantId: string,
    workspaceIds: string[],
  ): Promise<Map<string, WorkspaceListSummary>> {
    if (workspaceIds.length === 0) {
      return new Map();
    }

    const result = await this.pool.query<WorkspaceWorkflowSummaryRow>(
      `SELECT workspace_id::text AS workspace_id,
              COUNT(*) FILTER (WHERE state = 'active')::int AS active_workflow_count,
              COUNT(*) FILTER (WHERE state = 'completed')::int AS completed_workflow_count,
              COUNT(*) FILTER (WHERE state IN ('failed', 'paused'))::int AS attention_workflow_count,
              COUNT(*)::int AS total_workflow_count,
              MAX(COALESCE(completed_at, started_at, updated_at, created_at))::text AS last_workflow_activity_at
         FROM workflows
        WHERE tenant_id = $1
          AND workspace_id = ANY($2::uuid[])
        GROUP BY workspace_id`,
      [tenantId, workspaceIds],
    );

    return new Map(
      result.rows.map((row) => [
        row.workspace_id,
        {
          active_workflow_count: Number(row.active_workflow_count ?? 0),
          completed_workflow_count: Number(row.completed_workflow_count ?? 0),
          attention_workflow_count: Number(row.attention_workflow_count ?? 0),
          total_workflow_count: Number(row.total_workflow_count ?? 0),
          last_workflow_activity_at:
            typeof row.last_workflow_activity_at === 'string'
              ? row.last_workflow_activity_at
              : null,
        },
      ]),
    );
  }
}

function resolveWorkspaceGitVerificationToken(
  workspace: WorkspaceRow,
  input: VerifyWorkspaceGitAccessInput,
): string | null {
  if (input.git_token_mode === 'clear') {
    return null;
  }

  if (input.git_token_mode === 'replace') {
    const replacement = typeof input.git_token === 'string' ? input.git_token.trim() : '';
    if (!replacement) {
      throw new ValidationError('Git token is required when replacing repository access.');
    }
    if (isExternalSecretReference(replacement)) {
      throw new ValidationError(
        'Git access verification cannot use external secret references. Enter the concrete token value before saving.',
      );
    }
    return readWorkspaceGitVerificationSecret(
      replacement,
      'Git token could not be read for verification. Enter the token again before saving.',
    );
  }

  const settings = normalizeWorkspaceSettings(workspace.settings);
  const storedGitToken = settings.credentials.git_token ?? null;
  if (!storedGitToken) {
    return null;
  }
  if (isExternalSecretReference(storedGitToken)) {
    throw new ValidationError(
      'The stored Git token uses an external secret reference and cannot be reverified on save. Replace the token before changing the repository.',
    );
  }
  return readWorkspaceGitVerificationSecret(
    storedGitToken,
    'Stored Git token could not be read for verification. Replace the token before changing the repository.',
  );
}

function readWorkspaceGitVerificationSecret(secret: string, message: string): string {
  try {
    return readProviderSecret(secret);
  } catch {
    throw new ValidationError(message);
  }
}

function redactWorkspaceSecrets(workspace: WorkspaceRow): Record<string, unknown> {
  const record = workspace as Record<string, unknown>;
  const hasSecret = typeof record.git_webhook_secret === 'string' && record.git_webhook_secret.length > 0;
  const { git_webhook_secret: _removed, settings, memory, ...rest } = record;
  return {
    ...rest,
    settings: serializeWorkspaceSettings(settings),
    memory: sanitizeWorkspaceMemory(memory),
    git_webhook_secret_configured: hasSecret,
  };
}

function sanitizeWorkspaceMemory(value: unknown): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(normalizeRecord(value)).map(([key, entry]) => [
      key,
      sanitizeWorkspaceRecordValue(key, entry, WORKSPACE_MEMORY_SECRET_REDACTION),
    ]),
  );
}

function emptyWorkspaceListSummary(): WorkspaceListSummary {
  return {
    active_workflow_count: 0,
    completed_workflow_count: 0,
    attention_workflow_count: 0,
    total_workflow_count: 0,
    last_workflow_activity_at: null,
  };
}

function sanitizeMemoryForPersistence(memory: Record<string, unknown>): Record<string, unknown> {
  return sanitizeSecretLikeRecord(memory, {
    redactionValue: WORKSPACE_MEMORY_SECRET_REDACTION,
    allowSecretReferences: true,
  });
}

function sanitizeMemoryValueForPersistence(key: string, value: unknown): unknown {
  return sanitizeSecretLikeRecord(
    { [key]: value },
    { redactionValue: WORKSPACE_MEMORY_SECRET_REDACTION, allowSecretReferences: true },
  )[key];
}

function normalizeRepoUrl(url: string): string {
  return url
    .toLowerCase()
    .replace(/\.git$/, '')
    .replace(/^http:\/\//, 'https://');
}
