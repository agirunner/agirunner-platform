import { randomUUID } from 'node:crypto';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';
import { resolveOperatorRecordActorId } from './operator-record-authorship.js';

interface WorkflowSteeringSessionRow {
  id: string;
  tenant_id: string;
  workflow_id: string;
  title: string | null;
  status: string;
  created_by_type: string;
  created_by_id: string;
  created_at: Date;
  updated_at: Date;
}

interface WorkflowSteeringMessageRow {
  id: string;
  tenant_id: string;
  workflow_id: string;
  steering_session_id: string;
  role: string;
  content: string;
  structured_proposal: Record<string, unknown> | null;
  intervention_id: string | null;
  created_by_type: string;
  created_by_id: string;
  created_at: Date;
}

export interface WorkflowSteeringSessionRecord {
  id: string;
  workflow_id: string;
  title: string | null;
  status: string;
  created_by_type: string;
  created_by_id: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowSteeringMessageRecord {
  id: string;
  workflow_id: string;
  steering_session_id: string;
  role: string;
  content: string;
  structured_proposal: Record<string, unknown>;
  intervention_id: string | null;
  created_by_type: string;
  created_by_id: string;
  created_at: string;
}

export class WorkflowSteeringSessionService {
  constructor(private readonly pool: DatabasePool) {}

  async createSession(
    identity: ApiKeyIdentity,
    workflowId: string,
    input: { title?: string } = {},
  ): Promise<WorkflowSteeringSessionRecord> {
    await this.assertWorkflow(identity.tenantId, workflowId);
    const result = await this.pool.query<WorkflowSteeringSessionRow>(
      `INSERT INTO workflow_steering_sessions
         (id, tenant_id, workflow_id, title, status, created_by_type, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        randomUUID(),
        identity.tenantId,
        workflowId,
        sanitizeOptionalText(input.title),
        'active',
        identity.ownerType,
        resolveOperatorRecordActorId(identity),
      ],
    );
    return toWorkflowSteeringSessionRecord(result.rows[0]);
  }

  async listSessions(tenantId: string, workflowId: string): Promise<WorkflowSteeringSessionRecord[]> {
    await this.assertWorkflow(tenantId, workflowId);
    const result = await this.pool.query<WorkflowSteeringSessionRow>(
      `SELECT *
         FROM workflow_steering_sessions
        WHERE tenant_id = $1
          AND workflow_id = $2
        ORDER BY created_at DESC`,
      [tenantId, workflowId],
    );
    return result.rows.map(toWorkflowSteeringSessionRecord);
  }

  async appendMessage(
    identity: ApiKeyIdentity,
    workflowId: string,
    sessionId: string,
    input: {
      role: string;
      content: string;
      structuredProposal?: Record<string, unknown>;
      interventionId?: string;
    },
  ): Promise<WorkflowSteeringMessageRecord> {
    await this.assertSession(identity.tenantId, workflowId, sessionId);
    const result = await this.pool.query<WorkflowSteeringMessageRow>(
      `INSERT INTO workflow_steering_messages
         (id, tenant_id, workflow_id, steering_session_id, role, content, structured_proposal, intervention_id, created_by_type, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
       RETURNING *`,
      [
        randomUUID(),
        identity.tenantId,
        workflowId,
        sessionId,
        input.role.trim(),
        input.content.trim(),
        sanitizeRecord(input.structuredProposal),
        input.interventionId ?? null,
        identity.ownerType,
        resolveOperatorRecordActorId(identity),
      ],
    );
    return toWorkflowSteeringMessageRecord(result.rows[0]);
  }

  async listMessages(
    tenantId: string,
    workflowId: string,
    sessionId: string,
  ): Promise<WorkflowSteeringMessageRecord[]> {
    await this.assertSession(tenantId, workflowId, sessionId);
    const result = await this.pool.query<WorkflowSteeringMessageRow>(
      `SELECT *
         FROM workflow_steering_messages
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND steering_session_id = $3
        ORDER BY created_at ASC`,
      [tenantId, workflowId, sessionId],
    );
    return result.rows.map(toWorkflowSteeringMessageRecord);
  }

  private async assertWorkflow(tenantId: string, workflowId: string): Promise<void> {
    const result = await this.pool.query(
      `SELECT id
         FROM workflows
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, workflowId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workflow not found');
    }
  }

  private async assertSession(tenantId: string, workflowId: string, sessionId: string): Promise<void> {
    const result = await this.pool.query(
      `SELECT id
         FROM workflow_steering_sessions
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3`,
      [tenantId, workflowId, sessionId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workflow steering session not found');
    }
  }
}

function toWorkflowSteeringSessionRecord(row: WorkflowSteeringSessionRow): WorkflowSteeringSessionRecord {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    title: row.title,
    status: row.status,
    created_by_type: row.created_by_type,
    created_by_id: row.created_by_id,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function toWorkflowSteeringMessageRecord(row: WorkflowSteeringMessageRow): WorkflowSteeringMessageRecord {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    steering_session_id: row.steering_session_id,
    role: row.role,
    content: row.content,
    structured_proposal: sanitizeRecord(row.structured_proposal),
    intervention_id: row.intervention_id,
    created_by_type: row.created_by_type,
    created_by_id: row.created_by_id,
    created_at: row.created_at.toISOString(),
  };
}

function sanitizeOptionalText(value?: string): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeRecord(value?: Record<string, unknown> | null): Record<string, unknown> {
  if (!value || Array.isArray(value)) {
    return {};
  }
  return value;
}
