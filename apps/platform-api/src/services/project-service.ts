import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { AppEnv } from '../config/schema.js';
import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { TenantScopedRepository, type TenantRow } from '../db/tenant-scoped-repository.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import { EventService } from './event-service.js';
import type { ProjectMemoryMutationContext } from './project-memory-scope-service.js';
import {
  normalizeProjectSettings,
  parseProjectSettingsInput,
  serializeProjectSettings,
  type StoredProjectSettings,
} from './project-settings.js';
import { sanitizeSecretLikeRecord } from './secret-redaction.js';
import { encryptWebhookSecret, decryptWebhookSecret, isWebhookSecretEncrypted } from './webhook-secret-crypto.js';

interface ProjectListQuery {
  page: number;
  per_page: number;
  q?: string;
  is_active?: boolean;
}

interface CreateProjectInput {
  name: string;
  slug: string;
  description?: string;
  repository_url?: string;
  settings?: Record<string, unknown> | StoredProjectSettings;
  memory?: Record<string, unknown>;
}

interface UpdateProjectInput {
  name?: string;
  slug?: string;
  description?: string;
  repository_url?: string;
  settings?: Record<string, unknown> | StoredProjectSettings;
  is_active?: boolean;
}

interface ProjectMemoryPatch {
  key: string;
  value?: unknown;
  context?: ProjectMemoryMutationContext;
}

type ProjectRow = TenantRow & Record<string, unknown>;
const PROJECT_MEMORY_SECRET_REDACTION = 'redacted://project-memory-secret';
const PROJECT_SETTINGS_SECRET_REDACTION = 'redacted://project-settings-secret';

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
    { redactionValue: PROJECT_MEMORY_SECRET_REDACTION, allowSecretReferences: false },
  )[key];
}

function sanitizeProjectRecordValue(key: string, value: unknown, redactionValue: string): unknown {
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

export class ProjectService {
  private readonly encryptionKey: string;

  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
    config?: Pick<AppEnv, 'WEBHOOK_ENCRYPTION_KEY'>,
  ) {
    this.encryptionKey = config?.WEBHOOK_ENCRYPTION_KEY ?? '';
  }

  async createProject(identity: ApiKeyIdentity, input: CreateProjectInput) {
    const memory = normalizeRecord(input.memory);
    const memorySizeBytes = byteLengthJson(memory);
    const settings = parseProjectSettingsInput(input.settings);

    try {
      const result = await this.pool.query<Record<string, unknown>>(
        `INSERT INTO projects (
          tenant_id, name, slug, description, repository_url, settings, memory, memory_size_bytes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *`,
        [
          identity.tenantId,
          input.name,
          input.slug,
          input.description ?? null,
          input.repository_url ?? null,
          settings,
          memory,
          memorySizeBytes,
        ],
      );

      const project = result.rows[0] as ProjectRow;
      await this.eventService.emit({
        tenantId: identity.tenantId,
        type: 'project.created',
        entityType: 'project',
        entityId: project.id as string,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: { slug: project.slug },
      });

      return redactProjectSecrets(project);
    } catch (error) {
      if (isUniqueViolation(error, 'uq_project_tenant_slug')) {
        throw new ConflictError('Project slug already exists');
      }
      throw error;
    }
  }

  async listProjects(tenantId: string, query: ProjectListQuery) {
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
      repo.count('projects', conditions, values),
      repo.findAllPaginated<ProjectRow>(
        'projects',
        '*',
        conditions,
        values,
        'created_at DESC',
        query.per_page,
        offset,
      ),
    ]);

    const migratedRows = await Promise.all(rows.map((row) => this.ensureGitWebhookSecretEncrypted(tenantId, row)));

    return {
      data: migratedRows.map((row) => redactProjectSecrets(row)),
      meta: {
        total,
        page: query.page,
        per_page: query.per_page,
        pages: Math.ceil(total / query.per_page) || 1,
      },
    };
  }

  async getProject(tenantId: string, projectId: string) {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const project = await repo.findById<ProjectRow>('projects', '*', projectId);
    if (!project) {
      throw new NotFoundError('Project not found');
    }
    return redactProjectSecrets(await this.ensureGitWebhookSecretEncrypted(tenantId, project));
  }

  async updateProject(identity: ApiKeyIdentity, projectId: string, input: UpdateProjectInput) {
    const existing = await this.loadProjectRecord(identity.tenantId, projectId);
    const existingSettings = normalizeProjectSettings(existing.settings);
    const settings =
      input.settings !== undefined
        ? parseProjectSettingsInput(input.settings, existingSettings)
        : existingSettings;

    try {
      const result = await this.pool.query<Record<string, unknown>>(
        `UPDATE projects
         SET name = COALESCE($3, name),
             slug = COALESCE($4, slug),
             description = COALESCE($5, description),
             repository_url = COALESCE($6, repository_url),
             settings = $7,
             is_active = COALESCE($8, is_active),
             updated_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [
          identity.tenantId,
          projectId,
          input.name ?? null,
          input.slug ?? null,
          input.description ?? null,
          input.repository_url ?? null,
          settings,
          input.is_active ?? null,
        ],
      );

      if (!result.rowCount) {
        throw new NotFoundError('Project not found');
      }

      const project = result.rows[0] as ProjectRow;
      await this.eventService.emit({
        tenantId: identity.tenantId,
        type: 'project.updated',
        entityType: 'project',
        entityId: projectId,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: {
          name: project.name,
          slug: project.slug,
          is_active: project.is_active,
        },
      });

      return redactProjectSecrets(project);
    } catch (error) {
      if (isUniqueViolation(error, 'uq_project_tenant_slug')) {
        throw new ConflictError('Project slug already exists');
      }
      throw error;
    }
  }

  async patchProjectMemory(
    identity: ApiKeyIdentity,
    projectId: string,
    patch: ProjectMemoryPatch,
    client?: DatabaseClient,
  ) {
    return this.patchProjectMemoryEntries(identity, projectId, [patch], client);
  }

  async patchProjectMemoryEntries(
    identity: ApiKeyIdentity,
    projectId: string,
    patches: ProjectMemoryPatch[],
    client?: DatabaseClient,
  ) {
    if (patches.length === 0) {
      throw new ValidationError('Project memory updates cannot be empty');
    }

    const ownsTransaction = !client;
    const db = client ?? (await this.pool.connect());

    try {
      if (ownsTransaction) {
        await db.query('BEGIN');
      }

      let project = await this.loadProjectForMemoryMutation(identity.tenantId, projectId, db);
      let currentMemory = normalizeRecord(project.memory);

      for (const patch of patches) {
        if (!patch.key || patch.key.length > 256) {
          throw new ValidationError('Project memory key must be between 1 and 256 characters');
        }

        const nextMemory = {
          ...currentMemory,
          [patch.key]: patch.value,
        };
        const memoryMaxBytes = Number(project.memory_max_bytes ?? 1_048_576);
        const memorySizeBytes = byteLengthJson(nextMemory);

        if (memorySizeBytes > memoryMaxBytes) {
          throw new ValidationError('Project memory patch exceeds memory_max_bytes', {
            memory_size_bytes: memorySizeBytes,
            memory_max_bytes: memoryMaxBytes,
            key: patch.key,
          });
        }

        const result = await db.query<Record<string, unknown>>(
          `UPDATE projects
           SET memory = $3,
               memory_size_bytes = $4,
               updated_at = now()
           WHERE tenant_id = $1 AND id = $2
           RETURNING *`,
          [identity.tenantId, projectId, nextMemory, memorySizeBytes],
        );

        project = result.rows[0] as ProjectRow;
        currentMemory = normalizeRecord(project.memory);

        await this.eventService.emit(
          {
            tenantId: identity.tenantId,
            type: 'project.memory_updated',
            entityType: 'project',
            entityId: projectId,
            actorType: identity.scope,
            actorId: identity.keyPrefix,
            data: {
              key: patch.key,
              value: sanitizeMemoryEventValue(patch.key, patch.value),
              project_id: projectId,
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

      return redactProjectSecrets(project);
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

  async removeProjectMemory(
    identity: ApiKeyIdentity,
    projectId: string,
    key: string,
    client?: DatabaseClient,
    context?: ProjectMemoryMutationContext,
  ) {
    const project = await this.getProject(identity.tenantId, projectId);
    const currentMemory = normalizeRecord(project.memory);
    if (!(key in currentMemory)) {
      return project;
    }

    const nextMemory = { ...currentMemory };
    delete nextMemory[key];
    const memorySizeBytes = byteLengthJson(nextMemory);

    const db = client ?? this.pool;
    const result = await db.query<Record<string, unknown>>(
      `UPDATE projects
       SET memory = $3,
           memory_size_bytes = $4,
           updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [identity.tenantId, projectId, nextMemory, memorySizeBytes],
    );

    const updatedProject = result.rows[0] as ProjectRow;
    await this.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'project.memory_deleted',
        entityType: 'project',
        entityId: projectId,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: {
          key,
          deleted_value: sanitizeMemoryEventValue(key, currentMemory[key]),
          project_id: projectId,
          workflow_id: context?.workflow_id ?? null,
          work_item_id: context?.work_item_id ?? null,
          task_id: context?.task_id ?? null,
          stage_name: context?.stage_name ?? null,
          memory_size_bytes: memorySizeBytes,
        },
      },
      client,
    );

    return redactProjectSecrets(updatedProject);
  }

  async deleteProject(identity: ApiKeyIdentity, projectId: string) {
    await this.getProject(identity.tenantId, projectId);

    const [workflows, tasks] = await Promise.all([
      this.pool.query<{ total: string }>(
        'SELECT count(*)::text AS total FROM workflows WHERE tenant_id = $1 AND project_id = $2',
        [identity.tenantId, projectId],
      ),
      this.pool.query<{ total: string }>(
        'SELECT count(*)::text AS total FROM tasks WHERE tenant_id = $1 AND project_id = $2',
        [identity.tenantId, projectId],
      ),
    ]);

    if (Number(workflows.rows[0]?.total ?? '0') > 0 || Number(tasks.rows[0]?.total ?? '0') > 0) {
      throw new ConflictError('Project cannot be deleted while workflows or tasks reference it');
    }

    await this.pool.query('DELETE FROM projects WHERE tenant_id = $1 AND id = $2', [
      identity.tenantId,
      projectId,
    ]);

    await this.eventService.emit({
      tenantId: identity.tenantId,
      type: 'project.deleted',
      entityType: 'project',
      entityId: projectId,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: {},
    });

    return { id: projectId, deleted: true };
  }

  async setGitWebhookConfig(
    identity: ApiKeyIdentity,
    projectId: string,
    input: GitWebhookConfig,
  ) {
    await this.getProject(identity.tenantId, projectId);

    const encryptedSecret = encryptWebhookSecret(input.secret, this.encryptionKey);
    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE projects
       SET git_webhook_provider = $3,
           git_webhook_secret = $4,
           updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, name, slug, git_webhook_provider, is_active, updated_at`,
      [identity.tenantId, projectId, input.provider, encryptedSecret],
    );

    await this.eventService.emit({
      tenantId: identity.tenantId,
      type: 'project.git_webhook_configured',
      entityType: 'project',
      entityId: projectId,
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
    projectId: string,
  ): Promise<{ provider: GitWebhookProvider; secret: string } | null> {
    const result = await this.pool.query<{
      git_webhook_provider: GitWebhookProvider | null;
      git_webhook_secret: string | null;
    }>(
      'SELECT git_webhook_provider, git_webhook_secret FROM projects WHERE tenant_id = $1 AND id = $2',
      [tenantId, projectId],
    );

    if (!result.rowCount) {
      return null;
    }

    const row = result.rows[0];
    if (!row.git_webhook_provider || !row.git_webhook_secret) {
      return null;
    }

    const secret = await this.ensureProjectWebhookSecretEncrypted(
      tenantId,
      projectId,
      row.git_webhook_secret,
    );

    return {
      provider: row.git_webhook_provider,
      secret: decryptWebhookSecret(secret, this.encryptionKey),
    };
  }

  async findProjectByRepositoryUrl(
    repositoryUrl: string,
  ): Promise<{ id: string; tenant_id: string } | null> {
    const normalized = normalizeRepoUrl(repositoryUrl);
    const result = await this.pool.query<{ id: string; tenant_id: string }>(
      `SELECT id, tenant_id FROM projects
       WHERE LOWER(REPLACE(REPLACE(repository_url, '.git', ''), 'http://', 'https://')) = $1
         AND is_active = true
       LIMIT 1`,
      [normalized],
    );

    return result.rowCount ? result.rows[0] : null;
  }

  async getProjectModelOverride(
    tenantId: string,
    projectId: string,
  ): Promise<null> {
    await this.getProject(tenantId, projectId);
    return null;
  }

  private async ensureGitWebhookSecretEncrypted(tenantId: string, project: ProjectRow): Promise<ProjectRow> {
    const record = project as Record<string, unknown>;
    const secret = typeof record.git_webhook_secret === 'string' ? record.git_webhook_secret : null;
    if (!secret) {
      return project;
    }

    const encryptedSecret = await this.ensureProjectWebhookSecretEncrypted(
      tenantId,
      String(record.id),
      secret,
    );
    if (encryptedSecret === secret) {
      return project;
    }

    return {
      ...project,
      git_webhook_secret: encryptedSecret,
      updated_at: new Date(),
    };
  }

  private async ensureProjectWebhookSecretEncrypted(
    tenantId: string,
    projectId: string,
    secret: string,
  ): Promise<string> {
    if (isWebhookSecretEncrypted(secret)) {
      return secret;
    }

    const encryptedSecret = encryptWebhookSecret(secret, this.encryptionKey);
    await this.pool.query(
      `UPDATE projects
          SET git_webhook_secret = $3,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, projectId, encryptedSecret],
    );
    return encryptedSecret;
  }

  private async loadProjectForMemoryMutation(
    tenantId: string,
    projectId: string,
    client: DatabaseClient,
  ): Promise<ProjectRow> {
    const result = await client.query<Record<string, unknown>>(
      `SELECT *
         FROM projects
        WHERE tenant_id = $1
          AND id = $2
        FOR UPDATE`,
      [tenantId, projectId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Project not found');
    }
    return result.rows[0] as ProjectRow;
  }

  private async loadProjectRecord(tenantId: string, projectId: string): Promise<ProjectRow> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const project = await repo.findById<ProjectRow>('projects', '*', projectId);
    if (!project) {
      throw new NotFoundError('Project not found');
    }
    return project;
  }
}

function redactProjectSecrets(project: ProjectRow): Record<string, unknown> {
  const record = project as Record<string, unknown>;
  const hasSecret = typeof record.git_webhook_secret === 'string' && record.git_webhook_secret.length > 0;
  const { git_webhook_secret: _removed, settings, memory, ...rest } = record;
  return {
    ...rest,
    settings: serializeProjectSettings(settings),
    memory: sanitizeProjectMemory(memory),
    git_webhook_secret_configured: hasSecret,
  };
}

function sanitizeProjectMemory(value: unknown): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(normalizeRecord(value)).map(([key, entry]) => [
      key,
      sanitizeProjectRecordValue(key, entry, PROJECT_MEMORY_SECRET_REDACTION),
    ]),
  );
}

function normalizeRepoUrl(url: string): string {
  return url
    .toLowerCase()
    .replace(/\.git$/, '')
    .replace(/^http:\/\//, 'https://');
}
