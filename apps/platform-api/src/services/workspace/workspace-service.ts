import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { AppEnv } from '../../config/schema.js';
import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import { TenantScopedRepository } from '../../db/tenant-scoped-repository.js';
import { ConflictError, NotFoundError, ValidationError } from '../../errors/domain-errors.js';
import {
  DestructiveDeleteService,
  type DeleteImpactSummary,
} from '../destructive-delete-service.js';
import { EventService } from '../event-service.js';
import type { WorkspaceMemoryMutationContext } from './memory/workspace-memory-scope-service.js';
import {
  parseWorkspaceSettingsInput,
} from './workspace-settings.js';
import { resolveWorkspaceStorageBinding } from './workspace-storage.js';
import { encryptWebhookSecret } from '../webhook-secret-crypto.js';
import {
  WorkspaceGitAccessVerifier,
  type VerifyWorkspaceGitAccessResult,
} from './git/workspace-git-access-verifier.js';
import { resolveWorkspaceGitVerificationToken } from './git/workspace-git-verification.js';
import {
  byteLengthJson,
  emptyWorkspaceListSummary,
  normalizeRecord,
  redactWorkspaceSecrets,
  sanitizeMemoryForPersistence,
} from './workspace-records.js';
import { WorkspaceMemoryService } from './memory/workspace-memory-service.js';
import { WorkspaceRecordStore } from './workspace-record-store.js';
import { WorkspaceSecretStore } from './workspace-secret-store.js';
import type {
  CreateWorkspaceInput,
  GitWebhookConfig,
  WorkspaceListQuery,
  WorkspaceMemoryPatch,
  WorkspaceRow,
  UpdateWorkspaceInput,
  VerifyWorkspaceGitAccessInput,
} from './workspace-types.js';

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

export class WorkspaceService {
  private readonly encryptionKey: string;
  private readonly destructiveDeleteService: Pick<
    DestructiveDeleteService,
    'getWorkspaceDeleteImpact' | 'deleteWorkspaceCascading' | 'deleteWorkspaceWithoutDependencies'
  >;
  private readonly workspaceGitAccessVerifier: Pick<WorkspaceGitAccessVerifier, 'verify'>;
  private readonly workspaceSecretStore: WorkspaceSecretStore;
  private readonly workspaceRecordStore: WorkspaceRecordStore;
  private readonly workspaceMemoryService: WorkspaceMemoryService;

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
    this.workspaceSecretStore = new WorkspaceSecretStore(pool, this.encryptionKey);
    this.workspaceRecordStore = new WorkspaceRecordStore(pool, this.workspaceSecretStore);
    this.workspaceMemoryService = new WorkspaceMemoryService(
      pool,
      eventService,
      this.workspaceRecordStore,
    );
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

    const migratedRows = await Promise.all(
      rows.map((row) => this.workspaceSecretStore.ensureWorkspaceSecretsEncrypted(tenantId, row)),
    );
    const workflowSummaryByWorkspaceId = await this.workspaceRecordStore.loadWorkspaceWorkflowSummaries(
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
    const workspace = await this.workspaceRecordStore.loadWorkspaceRecord(tenantId, workspaceId);
    return redactWorkspaceSecrets(workspace);
  }

  async updateWorkspace(identity: ApiKeyIdentity, workspaceId: string, input: UpdateWorkspaceInput) {
    const existing = await this.workspaceRecordStore.loadWorkspaceRecord(identity.tenantId, workspaceId);
    const existingSettings = parseWorkspaceSettingsInput(existing.settings);
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
    return this.workspaceMemoryService.patchWorkspaceMemoryEntries(
      identity,
      workspaceId,
      [patch],
      client,
    );
  }

  async patchWorkspaceMemoryEntries(
    identity: ApiKeyIdentity,
    workspaceId: string,
    patches: WorkspaceMemoryPatch[],
    client?: DatabaseClient,
  ) {
    return this.workspaceMemoryService.patchWorkspaceMemoryEntries(
      identity,
      workspaceId,
      patches,
      client,
    );
  }

  async removeWorkspaceMemory(
    identity: ApiKeyIdentity,
    workspaceId: string,
    key: string,
    client?: DatabaseClient,
    context?: WorkspaceMemoryMutationContext,
  ) {
    return this.workspaceMemoryService.removeWorkspaceMemory(
      identity,
      workspaceId,
      key,
      client,
      context,
    );
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
  ) {
    return this.workspaceSecretStore.getGitWebhookSecret(tenantId, workspaceId);
  }

  async findWorkspaceByRepositoryUrl(
    repositoryUrl: string,
  ): Promise<{ id: string; tenant_id: string } | null> {
    return this.workspaceRecordStore.findWorkspaceByRepositoryUrl(repositoryUrl);
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
    const workspace = await this.workspaceRecordStore.loadWorkspaceRecord(identity.tenantId, workspaceId);
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
}
