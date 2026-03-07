import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import { EventService } from './event-service.js';

type ResourceType =
  | 'repository'
  | 'search'
  | 'document_store'
  | 'cloud_account'
  | 'artifact_store'
  | 'api';

interface ProjectSpecVersionRow {
  id: string;
  version: number;
  spec: Record<string, unknown>;
  created_at: Date;
  created_by_type: string;
  created_by_id: string | null;
}

interface ProjectRow {
  id: string;
  current_spec_version: number;
}

interface ResourceRecord {
  logical_name: string;
  type: ResourceType;
  binding: Record<string, unknown>;
  notes?: string;
}

const resourceFieldsByType: Record<ResourceType, string[]> = {
  repository: ['url'],
  search: ['provider'],
  document_store: ['provider'],
  cloud_account: ['provider'],
  artifact_store: ['provider'],
  api: ['base_url'],
};

const blockedBindingKeys = /(secret|token|password|api[_-]?key|credential)/i;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(message);
  }
  return value as Record<string, unknown>;
}

function validateUrlField(value: unknown, fieldName: string): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'string' || !/^https?:\/\/|^git@/.test(value)) {
    throw new ValidationError(`${fieldName} must be a valid URL or git remote`);
  }
}

export class ProjectSpecService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
  ) {}

  async getProjectSpec(tenantId: string, projectId: string, version?: number) {
    const project = await this.loadProjectOrThrow(tenantId, projectId);
    const targetVersion = version ?? project.current_spec_version;

    if (targetVersion === 0) {
      return {
        project_id: projectId,
        version: 0,
        spec: {},
        created_at: null,
        created_by_type: null,
        created_by_id: null,
      };
    }

    const result = await this.pool.query<ProjectSpecVersionRow>(
      `SELECT id, version, spec, created_at, created_by_type, created_by_id
         FROM project_spec_versions
        WHERE tenant_id = $1
          AND project_id = $2
          AND version = $3`,
      [tenantId, projectId, targetVersion],
    );

    if (!result.rowCount) {
      throw new NotFoundError('Project spec version not found');
    }

    const row = result.rows[0];
    return {
      project_id: projectId,
      version: row.version,
      spec: row.spec ?? {},
      created_at: row.created_at.toISOString(),
      created_by_type: row.created_by_type,
      created_by_id: row.created_by_id,
    };
  }

  async putProjectSpec(identity: ApiKeyIdentity, projectId: string, spec: Record<string, unknown>) {
    this.validateProjectSpec(spec);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const project = await this.loadProjectOrThrow(identity.tenantId, projectId, client, true);
      const nextVersion = project.current_spec_version + 1;

      await client.query(
        `INSERT INTO project_spec_versions (tenant_id, project_id, version, spec, created_by_type, created_by_id)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6)`,
        [
          identity.tenantId,
          projectId,
          nextVersion,
          spec,
          identity.scope,
          identity.keyPrefix,
        ],
      );

      await client.query(
        `UPDATE projects
            SET current_spec_version = $3,
                updated_at = now()
          WHERE tenant_id = $1
            AND id = $2`,
        [identity.tenantId, projectId, nextVersion],
      );

      await this.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'project.spec_updated',
          entityType: 'project',
          entityId: projectId,
          actorType: identity.scope,
          actorId: identity.keyPrefix,
          data: { version: nextVersion },
        },
        client,
      );

      await client.query('COMMIT');
      return this.getProjectSpec(identity.tenantId, projectId, nextVersion);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listProjectResources(
    identity: ApiKeyIdentity,
    projectId: string,
    query: { type?: string; task_id?: string },
  ) {
    const specEnvelope = await this.getProjectSpec(identity.tenantId, projectId);
    const resources = this.readResources(specEnvelope.spec);
    const filteredByType =
      query.type && query.type.length > 0
        ? resources.filter((resource) => resource.type === query.type)
        : resources;

    if (identity.scope !== 'agent') {
      return { data: filteredByType };
    }

    if (!query.task_id) {
      throw new ValidationError('task_id is required when an agent lists project resources');
    }

    const task = await this.loadTaskForAgent(identity, query.task_id, projectId);
    const allowedNames = this.readTaskResourceNames(task.resource_bindings);
    return {
      data: filteredByType.filter((resource) => allowedNames.has(resource.logical_name)),
    };
  }

  private validateProjectSpec(spec: Record<string, unknown>): void {
    const resources = this.readResourceMap(spec);
    for (const [logicalName, entry] of Object.entries(resources)) {
      if (!logicalName.trim()) {
        throw new ValidationError('Resource logical names must be non-empty');
      }

      const resource = requireRecord(entry, `Resource '${logicalName}' must be an object`);
      const type = resource.type;
      if (!this.isSupportedResourceType(type)) {
        throw new ValidationError(`Resource '${logicalName}' has unsupported type`);
      }

      const binding = requireRecord(resource.binding, `Resource '${logicalName}' binding must be an object`);
      this.validateBinding(type, logicalName, binding);
    }
  }

  private validateBinding(type: ResourceType, logicalName: string, binding: Record<string, unknown>): void {
    for (const requiredField of resourceFieldsByType[type]) {
      if (typeof binding[requiredField] !== 'string' || String(binding[requiredField]).trim().length === 0) {
        throw new ValidationError(`Resource '${logicalName}' is missing required binding field '${requiredField}'`);
      }
    }

    for (const key of Object.keys(binding)) {
      if (blockedBindingKeys.test(key)) {
        throw new ValidationError(`Resource '${logicalName}' binding contains forbidden credential-like field '${key}'`);
      }
    }

    validateUrlField(binding.url, `${logicalName}.binding.url`);
    validateUrlField(binding.endpoint, `${logicalName}.binding.endpoint`);
    validateUrlField(binding.base_url, `${logicalName}.binding.base_url`);
    validateUrlField(binding.spec_url, `${logicalName}.binding.spec_url`);
  }

  private readResources(spec: Record<string, unknown>): ResourceRecord[] {
    return Object.entries(this.readResourceMap(spec)).map(([logicalName, entry]) => {
      const resource = requireRecord(entry, `Resource '${logicalName}' must be an object`);
      const type = resource.type;
      if (!this.isSupportedResourceType(type)) {
        throw new ValidationError(`Resource '${logicalName}' has unsupported type`);
      }

      return {
        logical_name: logicalName,
        type,
        binding: requireRecord(resource.binding, `Resource '${logicalName}' binding must be an object`),
        ...(typeof resource.notes === 'string' ? { notes: resource.notes } : {}),
      };
    });
  }

  private readResourceMap(spec: Record<string, unknown>): Record<string, unknown> {
    return asRecord(spec.resources);
  }

  private async loadTaskForAgent(identity: ApiKeyIdentity, taskId: string, projectId: string) {
    const result = await this.pool.query<{ resource_bindings: unknown; assigned_agent_id: string | null }>(
      `SELECT resource_bindings, assigned_agent_id
         FROM tasks
        WHERE tenant_id = $1
          AND id = $2
          AND project_id = $3`,
      [identity.tenantId, taskId, projectId],
    );

    if (!result.rowCount) {
      throw new NotFoundError('Task not found');
    }

    const task = result.rows[0];
    if (identity.ownerId && task.assigned_agent_id !== identity.ownerId) {
      throw new ForbiddenError('Agent can only list resources for its currently assigned task');
    }

    return task;
  }

  private readTaskResourceNames(value: unknown): Set<string> {
    if (!Array.isArray(value)) {
      return new Set();
    }

    return new Set(
      value
        .map((entry) => asRecord(entry))
        .map(
          (entry) =>
            entry.logical_name ??
            entry.logicalName ??
            entry.resource ??
            entry.name,
        )
        .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0),
    );
  }

  private async loadProjectOrThrow(
    tenantId: string,
    projectId: string,
    client?: DatabaseClient,
    forUpdate = false,
  ): Promise<ProjectRow> {
    const db = client ?? this.pool;
    const result = await db.query<ProjectRow>(
      `SELECT id, current_spec_version
         FROM projects
        WHERE tenant_id = $1
          AND id = $2${forUpdate ? ' FOR UPDATE' : ''}`,
      [tenantId, projectId],
    );

    if (!result.rowCount) {
      throw new NotFoundError('Project not found');
    }

    return result.rows[0];
  }

  private isSupportedResourceType(value: unknown): value is ResourceType {
    return (
      value === 'repository' ||
      value === 'search' ||
      value === 'document_store' ||
      value === 'cloud_account' ||
      value === 'artifact_store' ||
      value === 'api'
    );
  }
}
