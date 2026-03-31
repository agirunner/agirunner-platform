import { randomUUID } from 'node:crypto';

import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabasePool } from '../../db/database.js';
import { NotFoundError, ValidationError } from '../../errors/domain-errors.js';
import { resolveOperatorRecordActorId } from '../operator-record-authorship.js';
import {
  dedupeNonEmptyStrings,
  deriveMessageBody,
  deriveMessageHeadline,
  deriveSessionTitle,
  firstArrayValue,
  sanitizeOptionalBody,
  sanitizeOptionalText,
  sanitizeRequiredText,
  toOptionalString,
} from './text-helpers.js';
import {
  toWorkflowSteeringMessageRecord,
  toWorkflowSteeringSessionRecord,
} from './record-mappers.js';
export type {
  WorkflowSteeringMessageKind,
  WorkflowSteeringMessageRecord,
  WorkflowSteeringRequestResult,
  WorkflowSteeringSessionRecord,
  WorkflowSteeringSourceKind,
} from './types.js';
import type {
  WorkflowSteeringMessageKind,
  WorkflowSteeringMessageRow,
  WorkflowSteeringRequestResult,
  WorkflowSteeringSessionRecord,
  WorkflowSteeringSessionRow,
  WorkflowSteeringSourceKind,
  WorkflowTaskScopeRow,
} from './types.js';
import type { WorkflowInterventionService } from '../workflow-intervention-service.js';

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
  ) {
    const session = await this.assertSession(identity.tenantId, workflowId, sessionId);
    const scopedWorkItemId = await this.resolveScopedWorkItemId(
      identity.tenantId,
      workflowId,
      session,
      input,
    );
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
  ) {
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
        ...(input.linkedInputPacketIds.length > 0
          ? { linked_input_packet_ids: input.linkedInputPacketIds }
          : {}),
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
