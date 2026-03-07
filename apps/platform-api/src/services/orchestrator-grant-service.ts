import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseClient, DatabasePool, DatabaseQueryable } from '../db/database.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import { EventService } from './event-service.js';

const SUBTASK_PERMISSION = 'create_subtasks';

interface GrantRow {
  id: string;
  tenant_id: string;
  agent_id: string;
  pipeline_id: string;
  permissions: string[];
  granted_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
}

export interface CreateGrantInput {
  agent_id: string;
  pipeline_id: string;
  permissions: string[];
  expires_at?: string;
}

export class OrchestratorGrantService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
  ) {}

  async createGrant(identity: ApiKeyIdentity, input: CreateGrantInput) {
    const permissions = normalizePermissions(input.permissions);
    const expiresAt = parseExpiresAt(input.expires_at);

    await this.assertAgentInTenant(identity.tenantId, input.agent_id);
    await this.assertPipelineInTenant(identity.tenantId, input.pipeline_id);

    const result = await this.pool.query<GrantRow>(
      `INSERT INTO orchestrator_grants (tenant_id, agent_id, pipeline_id, permissions, expires_at)
       VALUES ($1,$2,$3,$4::text[],$5)
       ON CONFLICT (agent_id, pipeline_id) WHERE revoked_at IS NULL
       DO UPDATE SET permissions = EXCLUDED.permissions, expires_at = EXCLUDED.expires_at, revoked_at = NULL
       RETURNING *`,
      [identity.tenantId, input.agent_id, input.pipeline_id, permissions, expiresAt],
    );

    await this.eventService.emit({
      tenantId: identity.tenantId,
      type: 'orchestrator.grant_created',
      entityType: 'pipeline',
      entityId: input.pipeline_id,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: {
        agent_id: input.agent_id,
        permissions,
      },
    });

    return toGrantResponse(result.rows[0]);
  }

  async listGrants(tenantId: string, query: { pipeline_id?: string; agent_id?: string }) {
    const conditions: string[] = ['tenant_id = $1', 'revoked_at IS NULL'];
    const values: unknown[] = [tenantId];

    if (query.pipeline_id) {
      values.push(query.pipeline_id);
      conditions.push(`pipeline_id = $${values.length}`);
    }

    if (query.agent_id) {
      values.push(query.agent_id);
      conditions.push(`agent_id = $${values.length}`);
    }

    const result = await this.pool.query<GrantRow>(
      `SELECT id, tenant_id, agent_id, pipeline_id, permissions, granted_at, expires_at, revoked_at
         FROM orchestrator_grants
        WHERE ${conditions.join(' AND ')}
        ORDER BY granted_at ASC`,
      values,
    );

    return { data: result.rows.map(toGrantResponse) };
  }

  async revokeGrant(identity: ApiKeyIdentity, grantId: string) {
    const result = await this.pool.query<GrantRow>(
      `UPDATE orchestrator_grants
          SET revoked_at = now()
        WHERE tenant_id = $1
          AND id = $2
          AND revoked_at IS NULL
      RETURNING *`,
      [identity.tenantId, grantId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Orchestrator grant not found');
    }

    await this.eventService.emit({
      tenantId: identity.tenantId,
      type: 'orchestrator.grant_revoked',
      entityType: 'pipeline',
      entityId: result.rows[0].pipeline_id,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: {
        agent_id: result.rows[0].agent_id,
        permissions: result.rows[0].permissions,
      },
    });

    return { id: grantId, revoked: true };
  }

  async hasPermission(
    tenantId: string,
    agentId: string,
    pipelineId: string,
    permission: string,
    db: DatabaseQueryable = this.pool,
  ): Promise<boolean> {
    const result = await db.query<{ id: string }>(
      `SELECT id
         FROM orchestrator_grants
        WHERE tenant_id = $1
          AND agent_id = $2
          AND pipeline_id = $3
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())
          AND $4 = ANY(permissions)
        LIMIT 1`,
      [tenantId, agentId, pipelineId, permission],
    );
    return (result.rowCount ?? 0) > 0;
  }

  subtaskPermission(): string {
    return SUBTASK_PERMISSION;
  }

  private async assertAgentInTenant(tenantId: string, agentId: string) {
    const result = await this.pool.query(
      'SELECT id FROM agents WHERE tenant_id = $1 AND id = $2',
      [tenantId, agentId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Agent not found');
    }
  }

  private async assertPipelineInTenant(tenantId: string, pipelineId: string) {
    const result = await this.pool.query(
      'SELECT id FROM pipelines WHERE tenant_id = $1 AND id = $2',
      [tenantId, pipelineId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Pipeline not found');
    }
  }
}

function normalizePermissions(permissions: string[]): string[] {
  const normalized = [...new Set(permissions.map((permission) => permission.trim()).filter(Boolean))];
  if (normalized.length === 0) {
    throw new ValidationError('permissions must contain at least one permission');
  }
  return normalized;
}

function parseExpiresAt(value?: string): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new ValidationError('expires_at must be a valid datetime');
  }
  if (parsed.getTime() <= Date.now()) {
    throw new ValidationError('expires_at must be in the future');
  }
  return parsed;
}

function toGrantResponse(row: GrantRow) {
  return {
    id: row.id,
    agent_id: row.agent_id,
    pipeline_id: row.pipeline_id,
    permissions: row.permissions,
    granted_at: row.granted_at.toISOString(),
    expires_at: row.expires_at?.toISOString() ?? null,
    revoked_at: row.revoked_at?.toISOString() ?? null,
  };
}
