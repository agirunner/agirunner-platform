import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { TenantScopedRepository, type TenantRow } from '../db/tenant-scoped-repository.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import { EventService } from './event-service.js';

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
  settings?: Record<string, unknown>;
  memory?: Record<string, unknown>;
}

interface UpdateProjectInput {
  name?: string;
  slug?: string;
  description?: string;
  repository_url?: string;
  settings?: Record<string, unknown>;
  is_active?: boolean;
}

type ProjectRow = TenantRow & Record<string, unknown>;

function byteLengthJson(value: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
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

export class ProjectService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
  ) {}

  async createProject(identity: ApiKeyIdentity, input: CreateProjectInput) {
    const memory = normalizeRecord(input.memory);
    const memorySizeBytes = byteLengthJson(memory);

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
          normalizeRecord(input.settings),
          memory,
          memorySizeBytes,
        ],
      );

      const project = result.rows[0] as Record<string, unknown>;
      await this.eventService.emit({
        tenantId: identity.tenantId,
        type: 'project.created',
        entityType: 'project',
        entityId: project.id as string,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: { slug: project.slug },
      });

      return project;
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

    return {
      data: rows,
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
    return project;
  }

  async updateProject(identity: ApiKeyIdentity, projectId: string, input: UpdateProjectInput) {
    const existing = await this.getProject(identity.tenantId, projectId);

    const settings =
      input.settings !== undefined
        ? normalizeRecord(input.settings)
        : normalizeRecord(existing.settings);

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

      const project = result.rows[0] as Record<string, unknown>;
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

      return project;
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
    patch: { key: string; value?: unknown },
  ) {
    const project = await this.getProject(identity.tenantId, projectId);
    const currentMemory = normalizeRecord(project.memory);
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

    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE projects
       SET memory = $3,
           memory_size_bytes = $4,
           updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [identity.tenantId, projectId, nextMemory, memorySizeBytes],
    );

    const updatedProject = result.rows[0] as Record<string, unknown>;

    await this.eventService.emit({
      tenantId: identity.tenantId,
      type: 'project.memory_updated',
      entityType: 'project',
      entityId: projectId,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: {
        key: patch.key,
        memory_size_bytes: memorySizeBytes,
      },
    });

    return updatedProject;
  }

  async deleteProject(identity: ApiKeyIdentity, projectId: string) {
    await this.getProject(identity.tenantId, projectId);

    const [pipelines, tasks] = await Promise.all([
      this.pool.query<{ total: string }>(
        'SELECT count(*)::text AS total FROM pipelines WHERE tenant_id = $1 AND project_id = $2',
        [identity.tenantId, projectId],
      ),
      this.pool.query<{ total: string }>(
        'SELECT count(*)::text AS total FROM tasks WHERE tenant_id = $1 AND project_id = $2',
        [identity.tenantId, projectId],
      ),
    ]);

    if (Number(pipelines.rows[0]?.total ?? '0') > 0 || Number(tasks.rows[0]?.total ?? '0') > 0) {
      throw new ConflictError('Project cannot be deleted while pipelines or tasks reference it');
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
}
