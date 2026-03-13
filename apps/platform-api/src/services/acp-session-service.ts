import { randomUUID } from 'node:crypto';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import { EventService } from './event-service.js';
import { sanitizeSecretLikeRecord } from './secret-redaction.js';

interface CreateSessionInput {
  agent_id: string;
  worker_id?: string;
  workflow_id?: string;
  transport: 'stdio' | 'http' | 'websocket';
  mode: 'run' | 'session';
  workspace_path?: string;
  metadata?: Record<string, unknown>;
}

interface SessionHeartbeatInput {
  status?: 'initializing' | 'active' | 'idle' | 'closed';
  metadata?: Record<string, unknown>;
}

const ACP_SESSION_SECRET_REDACTION = 'redacted://acp-session-secret';

export class AcpSessionService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
  ) {}

  async createOrReuseSession(identity: ApiKeyIdentity, input: CreateSessionInput) {
    const agent = await this.loadAcpAgent(identity, input.agent_id);
    const existing = input.mode === 'session'
      ? await this.findReusableSession(identity.tenantId, input.agent_id, input.workflow_id)
      : null;

    if (existing) {
      return { ...existing, reused: true };
    }

    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO acp_sessions (
         id, tenant_id, agent_id, worker_id, workflow_id, transport, mode, status, workspace_path, metadata, last_heartbeat_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'initializing',$8,$9,NOW())
       RETURNING *`,
      [
        randomUUID(),
        identity.tenantId,
        input.agent_id,
        input.worker_id ?? null,
        input.workflow_id ?? null,
        input.transport,
        input.mode,
        input.workspace_path ?? null,
        sanitizeAcpSessionMetadata({
          ...(input.metadata ?? {}),
          protocol: 'acp',
          capabilities: readAcpCapabilities(agent.metadata),
        }),
      ],
    );

    const session = toSessionResponse(result.rows[0]);
    await this.eventService.emit({
      tenantId: identity.tenantId,
      type: 'acp.session_created',
      entityType: 'agent',
      entityId: input.agent_id,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: { session_id: session.id, workflow_id: input.workflow_id ?? null, mode: input.mode },
    });
    return { ...session, reused: false };
  }

  async heartbeat(identity: ApiKeyIdentity, sessionId: string, input: SessionHeartbeatInput = {}) {
    const session = await this.loadSession(identity.tenantId, sessionId);
    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE acp_sessions
          SET status = COALESCE($3, status),
              metadata = metadata || $4::jsonb,
              last_heartbeat_at = NOW(),
              updated_at = NOW()
        WHERE tenant_id = $1
          AND id = $2
        RETURNING *`,
      [
        identity.tenantId,
        sessionId,
        input.status ?? null,
        sanitizeAcpSessionMetadata(input.metadata ?? {}),
      ],
    );

    await this.pool.query(
      `UPDATE agents
          SET last_heartbeat_at = NOW(),
              status = CASE
                WHEN $3 = 'closed' THEN 'idle'::agent_status
                WHEN current_task_id IS NULL THEN 'active'::agent_status
                ELSE 'busy'::agent_status
              END
        WHERE tenant_id = $1
          AND id = $2`,
      [identity.tenantId, session.agent_id, input.status ?? null],
    );

    return toSessionResponse(result.rows[0]);
  }

  async getSession(tenantId: string, sessionId: string) {
    const session = await this.loadSession(tenantId, sessionId);
    return toSessionResponse(session);
  }

  normalizeOutput(payload: {
    content?: unknown;
    terminal_output?: string;
    diff?: string;
    metadata?: Record<string, unknown>;
    result?: unknown;
  }) {
    return {
      result: payload.result ?? null,
      content: payload.content ?? null,
      terminal_output: payload.terminal_output ?? null,
      diff: payload.diff ?? null,
      protocol: 'acp',
      metadata: payload.metadata ?? {},
    };
  }

  private async loadAcpAgent(identity: ApiKeyIdentity, agentId: string) {
    if (identity.scope === 'agent' && identity.ownerId && identity.ownerId !== agentId) {
      throw new ForbiddenError('Agent keys may only open ACP sessions for themselves.');
    }

    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT id, metadata
         FROM agents
        WHERE tenant_id = $1
          AND id = $2`,
      [identity.tenantId, agentId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Agent not found');
    }

    const agent = result.rows[0];
    const protocol = String(asRecord(agent.metadata).protocol ?? 'rest');
    if (protocol !== 'acp') {
      throw new ValidationError('Agent is not registered for ACP.');
    }
    return agent;
  }

  private async findReusableSession(tenantId: string, agentId: string, workflowId?: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT *
         FROM acp_sessions
        WHERE tenant_id = $1
          AND agent_id = $2
          AND COALESCE(workflow_id::text, '') = COALESCE($3::text, '')
          AND mode = 'session'
          AND status IN ('initializing', 'active', 'idle')
        ORDER BY updated_at DESC
        LIMIT 1`,
      [tenantId, agentId, workflowId ?? null],
    );
    return result.rowCount ? toSessionResponse(result.rows[0]) : null;
  }

  private async loadSession(tenantId: string, sessionId: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT *
         FROM acp_sessions
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, sessionId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('ACP session not found');
    }
    return result.rows[0];
  }
}

function toSessionResponse(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    agent_id: String(row.agent_id),
    worker_id: readString(row.worker_id),
    workflow_id: readString(row.workflow_id),
    transport: String(row.transport),
    mode: String(row.mode),
    status: String(row.status),
    workspace_path: readString(row.workspace_path),
    metadata: sanitizeAcpSessionMetadata(row.metadata),
    last_heartbeat_at: readString(row.last_heartbeat_at),
    created_at: readString(row.created_at),
    updated_at: readString(row.updated_at),
  };
}

function sanitizeAcpSessionMetadata(value: unknown): Record<string, unknown> {
  return sanitizeSecretLikeRecord(value, {
    redactionValue: ACP_SESSION_SECRET_REDACTION,
    allowSecretReferences: false,
  });
}

function readAcpCapabilities(metadata: unknown) {
  return asRecord(asRecord(metadata).acp).capabilities ?? {};
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
