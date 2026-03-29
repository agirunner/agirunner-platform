import { randomUUID } from 'node:crypto';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import { resolveOperatorRecordActorId } from './operator-record-authorship.js';
import type { WorkflowInterventionService } from './workflow-intervention-service.js';

type WorkflowSteeringSourceKind = 'operator' | 'platform' | 'system';
type WorkflowSteeringMessageKind = 'operator_request' | 'steering_response' | 'system_notice';
type WorkflowSteeringSessionStatus = 'open' | 'closed' | 'archived';

interface WorkflowSteeringSessionRow {
  id: string;
  tenant_id: string;
  workflow_id: string;
  work_item_id: string | null;
  title: string | null;
  status: WorkflowSteeringSessionStatus;
  created_by_type: string;
  created_by_id: string;
  created_at: Date;
  updated_at: Date;
  last_message_at: Date | null;
}

interface WorkflowSteeringMessageRow {
  id: string;
  tenant_id: string;
  workflow_id: string;
  work_item_id: string | null;
  steering_session_id: string;
  source_kind: WorkflowSteeringSourceKind;
  message_kind: WorkflowSteeringMessageKind;
  headline: string;
  body: string | null;
  linked_intervention_id: string | null;
  linked_input_packet_id: string | null;
  linked_operator_update_id: string | null;
  created_by_type: string;
  created_by_id: string;
  created_at: Date;
}

interface WorkflowTaskScopeRow {
  work_item_id: string | null;
}

export interface WorkflowSteeringSessionRecord {
  id: string;
  workflow_id: string;
  work_item_id: string | null;
  title: string | null;
  status: WorkflowSteeringSessionStatus;
  created_by_type: string;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
}

export interface WorkflowSteeringMessageRecord {
  id: string;
  workflow_id: string;
  work_item_id: string | null;
  steering_session_id: string;
  source_kind: WorkflowSteeringSourceKind;
  message_kind: WorkflowSteeringMessageKind;
  headline: string;
  body: string | null;
  linked_intervention_id: string | null;
  linked_input_packet_id: string | null;
  linked_operator_update_id: string | null;
  created_by_type: string;
  created_by_id: string;
  created_at: string;
}

export interface WorkflowSteeringRequestResult {
  outcome: 'applied';
  result_kind: 'steering_request_recorded';
  source_workflow_id: string;
  workflow_id: string;
  resulting_work_item_id: string | null;
  input_packet_id: string | null;
  intervention_id: string | null;
  snapshot_version: string | null;
  settings_revision: number | null;
  message: string;
  redrive_lineage: null;
  steering_session_id: string;
  request_message_id: string;
  response_message_id: string | null;
  linked_intervention_ids: string[];
  linked_input_packet_ids: string[];
}

export class WorkflowSteeringSessionService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly interventionService?: Pick<WorkflowInterventionService, 'recordIntervention'>,
  ) {}

  async createSession(
    identity: ApiKeyIdentity,
    workflowId: string,
    input: { title?: string; workItemId?: string } = {},
  ): Promise<WorkflowSteeringSessionRecord> {
    await this.assertWorkflow(identity.tenantId, workflowId);
    if (input.workItemId) {
      await this.assertWorkItem(identity.tenantId, workflowId, input.workItemId);
    }
    const result = await this.pool.query<WorkflowSteeringSessionRow>(
      `INSERT INTO workflow_steering_sessions
         (id, tenant_id, workflow_id, work_item_id, title, status, created_by_type, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        randomUUID(),
        identity.tenantId,
        workflowId,
        input.workItemId ?? null,
        sanitizeOptionalText(input.title),
        'open',
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
        ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC, created_at DESC`,
      [tenantId, workflowId],
    );
    return result.rows.map(toWorkflowSteeringSessionRecord);
  }

  async appendMessage(
    identity: ApiKeyIdentity,
    workflowId: string,
    sessionId: string,
    input: {
      workItemId?: string;
      sourceKind: WorkflowSteeringSourceKind;
      messageKind: WorkflowSteeringMessageKind;
      headline: string;
      body?: string;
      linkedInterventionId?: string;
      linkedInputPacketId?: string;
      linkedOperatorUpdateId?: string;
    },
  ): Promise<WorkflowSteeringMessageRecord> {
    const session = await this.assertSession(identity.tenantId, workflowId, sessionId);
    const scopedWorkItemId = await this.resolveScopedWorkItemId(identity.tenantId, workflowId, session, input);
    const result = await this.pool.query<WorkflowSteeringMessageRow>(
      `INSERT INTO workflow_steering_messages
         (
           id,
           tenant_id,
           workflow_id,
           work_item_id,
           steering_session_id,
           source_kind,
           message_kind,
           headline,
           body,
           linked_intervention_id,
           linked_input_packet_id,
           linked_operator_update_id,
           created_by_type,
           created_by_id
         )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        randomUUID(),
        identity.tenantId,
        workflowId,
        scopedWorkItemId,
        sessionId,
        input.sourceKind,
        input.messageKind,
        sanitizeRequiredText(input.headline, 'Steering headline is required'),
        sanitizeOptionalBody(input.body),
        input.linkedInterventionId ?? null,
        input.linkedInputPacketId ?? null,
        input.linkedOperatorUpdateId ?? null,
        identity.ownerType,
        resolveOperatorRecordActorId(identity),
      ],
    );
    await this.touchSession(identity.tenantId, workflowId, sessionId);
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

  async recordSteeringRequest(
    identity: ApiKeyIdentity,
    workflowId: string,
    input: {
      requestId: string;
      request: string;
      workItemId?: string;
      taskId?: string;
      linkedInputPacketIds?: string[];
      sessionId?: string;
      baseSnapshotVersion?: string;
    },
  ): Promise<WorkflowSteeringRequestResult> {
    await this.assertWorkflow(identity.tenantId, workflowId);
    const scopedWorkItemId = await this.resolveSteeringRequestScope(
      identity.tenantId,
      workflowId,
      input.workItemId,
      input.taskId,
    );
    const session = input.sessionId
      ? await this.assertSession(identity.tenantId, workflowId, input.sessionId)
      : await this.createSession(identity, workflowId, {
          title: deriveSessionTitle(input.request),
          workItemId: scopedWorkItemId ?? undefined,
        });
    const requestMessage = await this.appendMessage(identity, workflowId, session.id, {
      workItemId: toOptionalString(scopedWorkItemId),
      sourceKind: 'operator',
      messageKind: 'operator_request',
      headline: deriveMessageHeadline(input.request),
      body: deriveMessageBody(input.request),
      linkedInputPacketId: firstArrayValue(input.linkedInputPacketIds),
    });
    const linkedIntervention = await this.recordLinkedIntervention(identity, workflowId, session.id, {
      requestId: input.requestId,
      request: input.request,
      workItemId: scopedWorkItemId ?? undefined,
      taskId: input.taskId,
      linkedInputPacketIds: dedupeNonEmptyStrings(input.linkedInputPacketIds),
      baseSnapshotVersion: input.baseSnapshotVersion,
    });

    return {
      outcome: 'applied',
      result_kind: 'steering_request_recorded',
      source_workflow_id: workflowId,
      workflow_id: workflowId,
      resulting_work_item_id: scopedWorkItemId,
      input_packet_id: null,
      intervention_id: linkedIntervention?.id ?? null,
      snapshot_version: input.baseSnapshotVersion ?? null,
      settings_revision: null,
      message: 'Steering request recorded.',
      redrive_lineage: null,
      steering_session_id: session.id,
      request_message_id: requestMessage.id,
      response_message_id: null,
      linked_intervention_ids: linkedIntervention ? [linkedIntervention.id] : [],
      linked_input_packet_ids: dedupeNonEmptyStrings(input.linkedInputPacketIds),
    };
  }

  private async recordLinkedIntervention(
    identity: ApiKeyIdentity,
    workflowId: string,
    sessionId: string,
    input: {
      requestId: string;
      request: string;
      workItemId?: string;
      taskId?: string;
      linkedInputPacketIds: string[];
      baseSnapshotVersion?: string;
    },
  ) {
    if (!this.interventionService) {
      return null;
    }

    return this.interventionService.recordIntervention(identity, workflowId, {
      requestId: input.requestId,
      kind: 'steering_request',
      origin: 'operator',
      status: 'applied',
      outcome: 'applied',
      resultKind: 'steering_request_recorded',
      snapshotVersion: input.baseSnapshotVersion,
      summary: deriveMessageHeadline(input.request),
      message: 'Steering request recorded.',
      note: deriveMessageBody(input.request),
      structuredAction: {
        kind: input.taskId ? 'steer_task' : input.workItemId ? 'steer_work_item' : 'steer_workflow',
        request: sanitizeRequiredText(input.request, 'Steering request is required'),
        ...(input.workItemId ? { work_item_id: input.workItemId } : {}),
        ...(input.taskId ? { task_id: input.taskId } : {}),
        ...(input.linkedInputPacketIds.length > 0 ? { linked_input_packet_ids: input.linkedInputPacketIds } : {}),
      },
      metadata: {
        steering_session_id: sessionId,
      },
      workItemId: input.workItemId,
      taskId: input.taskId,
      files: [],
    });
  }

  private async touchSession(tenantId: string, workflowId: string, sessionId: string): Promise<void> {
    await this.pool.query(
      `UPDATE workflow_steering_sessions
          SET updated_at = NOW(),
              last_message_at = NOW()
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3`,
      [tenantId, workflowId, sessionId],
    );
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

  private async assertWorkItem(tenantId: string, workflowId: string, workItemId: string): Promise<void> {
    const result = await this.pool.query(
      `SELECT id
         FROM workflow_work_items
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3`,
      [tenantId, workflowId, workItemId],
    );
    if (!result.rowCount) {
      throw new ValidationError('Work item must belong to the selected workflow');
    }
  }

  private async readTaskScope(
    tenantId: string,
    workflowId: string,
    taskId: string,
  ): Promise<WorkflowTaskScopeRow> {
    const result = await this.pool.query<WorkflowTaskScopeRow>(
      `SELECT work_item_id
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3`,
      [tenantId, workflowId, taskId],
    );
    if (!result.rowCount) {
      throw new ValidationError('Task must belong to the selected workflow');
    }
    return result.rows[0];
  }

  private async assertSession(
    tenantId: string,
    workflowId: string,
    sessionId: string,
  ): Promise<WorkflowSteeringSessionRow> {
    const result = await this.pool.query<WorkflowSteeringSessionRow>(
      `SELECT *
         FROM workflow_steering_sessions
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3`,
      [tenantId, workflowId, sessionId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workflow steering session not found');
    }
    return result.rows[0];
  }

  private async resolveScopedWorkItemId(
    tenantId: string,
    workflowId: string,
    session: WorkflowSteeringSessionRow,
    input: { workItemId?: string },
  ): Promise<string | null> {
    if (input.workItemId) {
      await this.assertWorkItem(tenantId, workflowId, input.workItemId);
    }
    if (session.work_item_id && input.workItemId && session.work_item_id !== input.workItemId) {
      throw new ValidationError('Steering messages must stay within the session work-item scope');
    }
    return input.workItemId ?? session.work_item_id ?? null;
  }

  private async resolveSteeringRequestScope(
    tenantId: string,
    workflowId: string,
    workItemId?: string,
    taskId?: string,
  ): Promise<string | null> {
    if (workItemId) {
      await this.assertWorkItem(tenantId, workflowId, workItemId);
    }
    if (!taskId) {
      return workItemId ?? null;
    }
    const taskScope = await this.readTaskScope(tenantId, workflowId, taskId);
    if (workItemId && taskScope.work_item_id && taskScope.work_item_id !== workItemId) {
      throw new ValidationError('Task must belong to the selected workflow work item');
    }
    return workItemId ?? taskScope.work_item_id ?? null;
  }
}

function toWorkflowSteeringSessionRecord(row: WorkflowSteeringSessionRow): WorkflowSteeringSessionRecord {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    work_item_id: row.work_item_id,
    title: row.title,
    status: row.status,
    created_by_type: row.created_by_type,
    created_by_id: row.created_by_id,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    last_message_at: row.last_message_at ? row.last_message_at.toISOString() : null,
  };
}

function toWorkflowSteeringMessageRecord(row: WorkflowSteeringMessageRow): WorkflowSteeringMessageRecord {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    work_item_id: row.work_item_id,
    steering_session_id: row.steering_session_id,
    source_kind: row.source_kind,
    message_kind: row.message_kind,
    headline: row.headline,
    body: row.body,
    linked_intervention_id: row.linked_intervention_id,
    linked_input_packet_id: row.linked_input_packet_id,
    linked_operator_update_id: row.linked_operator_update_id,
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

function sanitizeRequiredText(value: string, errorMessage: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(errorMessage);
  }
  return trimmed;
}

function sanitizeOptionalBody(value?: string): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function deriveSessionTitle(request: string): string {
  return deriveMessageHeadline(request);
}

function deriveMessageHeadline(request: string): string {
  const trimmed = sanitizeRequiredText(request, 'Steering request is required');
  return trimmed.length <= 255 ? trimmed : `${trimmed.slice(0, 252)}...`;
}

function deriveMessageBody(request: string): string | undefined {
  const trimmed = sanitizeRequiredText(request, 'Steering request is required');
  return trimmed.length > 255 ? trimmed : undefined;
}

function firstArrayValue(values?: string[]): string | undefined {
  return dedupeNonEmptyStrings(values)[0];
}

function dedupeNonEmptyStrings(values?: string[]): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function toOptionalString(value: string | null): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
