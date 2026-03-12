import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError, UnauthorizedError, ValidationError } from '../errors/domain-errors.js';
import { hasBoardColumn, hasStage, parsePlaybookDefinition } from '../orchestration/playbook-model.js';
import { EventService } from './event-service.js';
import {
  buildTriggeredWorkItem,
  toPublicTrigger,
  validateTriggerDefinition,
  verifyTriggerSignature,
  type SignatureMode,
  type WorkItemTriggerInvocationHeaders,
  type WorkItemTriggerRow,
} from './webhook-work-item-trigger-helpers.js';
import { encryptWebhookSecret, isWebhookSecretEncrypted } from './webhook-secret-crypto.js';
import type { WorkflowService } from './workflow-service.js';

interface InvocationRow {
  id: string;
  work_item_id: string | null;
  status: string;
}

interface WorkflowScopeRow {
  project_id: string | null;
  playbook_id: string | null;
  definition: unknown;
}

export interface CreateWebhookWorkItemTriggerInput {
  name: string;
  source: string;
  project_id?: string;
  workflow_id: string;
  event_header?: string;
  event_types?: string[];
  signature_header: string;
  signature_mode: SignatureMode;
  secret: string;
  field_mappings?: Record<string, unknown>;
  defaults?: Record<string, unknown>;
  is_active?: boolean;
}

export interface UpdateWebhookWorkItemTriggerInput {
  name?: string;
  source?: string;
  project_id?: string | null;
  workflow_id?: string;
  event_header?: string | null;
  event_types?: string[];
  signature_header?: string;
  signature_mode?: SignatureMode;
  secret?: string;
  field_mappings?: Record<string, unknown>;
  defaults?: Record<string, unknown>;
  is_active?: boolean;
}

export class WebhookWorkItemTriggerService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
    private readonly workflowService: WorkflowService,
    private readonly encryptionKey: string,
  ) {}

  async createTrigger(identity: ApiKeyIdentity, input: CreateWebhookWorkItemTriggerInput) {
    const normalized = await this.normalizeTriggerInput(identity.tenantId, input);
    const result = await this.pool.query<WorkItemTriggerRow>(
      `INSERT INTO webhook_work_item_triggers (
         tenant_id, name, source, project_id, workflow_id, event_header, event_types,
         signature_header, signature_mode, secret, field_mappings, defaults, is_active
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13)
       RETURNING *`,
      [
        identity.tenantId,
        normalized.name,
        normalized.source,
        normalized.project_id,
        normalized.workflow_id,
        normalized.event_header,
        normalized.event_types,
        normalized.signature_header,
        normalized.signature_mode,
        normalized.secret,
        normalized.field_mappings,
        normalized.defaults,
        normalized.is_active,
      ],
    );

    await this.eventService.emit({
      tenantId: identity.tenantId,
      type: 'trigger.created',
      entityType: 'workflow',
      entityId: normalized.workflow_id,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: { trigger_id: result.rows[0].id, source: normalized.source },
    });

    return toPublicTrigger(result.rows[0]);
  }

  async updateTrigger(tenantId: string, triggerId: string, input: UpdateWebhookWorkItemTriggerInput) {
    const current = await this.loadTriggerRow(tenantId, triggerId);
    const normalized = await this.normalizeTriggerInput(tenantId, {
      name: input.name ?? current.name,
      source: input.source ?? current.source,
      project_id: input.project_id === undefined ? current.project_id ?? undefined : input.project_id ?? undefined,
      workflow_id: input.workflow_id ?? current.workflow_id,
      event_header: input.event_header === undefined ? current.event_header ?? undefined : input.event_header ?? undefined,
      event_types: input.event_types ?? current.event_types ?? [],
      signature_header: input.signature_header ?? current.signature_header,
      signature_mode: input.signature_mode ?? current.signature_mode,
      secret: input.secret ?? this.decryptlessSecretSentinel(current.secret),
      field_mappings: input.field_mappings ?? current.field_mappings ?? {},
      defaults: input.defaults ?? current.defaults ?? {},
      is_active: input.is_active ?? current.is_active,
    }, current.secret);

    const result = await this.pool.query<WorkItemTriggerRow>(
      `UPDATE webhook_work_item_triggers
          SET name = $3,
              source = $4,
              project_id = $5,
              workflow_id = $6,
              event_header = $7,
              event_types = $8,
              signature_header = $9,
              signature_mode = $10,
              secret = $11,
              field_mappings = $12::jsonb,
              defaults = $13::jsonb,
              is_active = $14,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2
      RETURNING *`,
      [
        tenantId,
        triggerId,
        normalized.name,
        normalized.source,
        normalized.project_id,
        normalized.workflow_id,
        normalized.event_header,
        normalized.event_types,
        normalized.signature_header,
        normalized.signature_mode,
        normalized.secret,
        normalized.field_mappings,
        normalized.defaults,
        normalized.is_active,
      ],
    );

    return toPublicTrigger(result.rows[0]);
  }

  async listTriggers(tenantId: string) {
    const result = await this.pool.query<WorkItemTriggerRow>(
      `SELECT *
         FROM webhook_work_item_triggers
        WHERE tenant_id = $1
        ORDER BY created_at DESC`,
      [tenantId],
    );
    const rows = await Promise.all(result.rows.map((row) => this.ensureStoredSecretEncrypted(row)));
    return { data: rows.map(toPublicTrigger) };
  }

  async deleteTrigger(tenantId: string, triggerId: string) {
    await this.pool.query(
      'DELETE FROM webhook_work_item_trigger_invocations WHERE tenant_id = $1 AND trigger_id = $2',
      [tenantId, triggerId],
    );
    const result = await this.pool.query(
      'DELETE FROM webhook_work_item_triggers WHERE tenant_id = $1 AND id = $2 RETURNING id',
      [tenantId, triggerId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Webhook work item trigger not found');
    }
    return { id: triggerId, deleted: true };
  }

  async invokeTrigger(
    triggerId: string,
    headers: WorkItemTriggerInvocationHeaders,
    rawBody: Buffer,
    payload: Record<string, unknown>,
  ) {
    const trigger = await this.loadTriggerById(triggerId);
    if (!trigger.is_active) {
      throw new UnauthorizedError('Webhook trigger is inactive');
    }

    const eventType = headers[trigger.event_header?.toLowerCase() ?? ''];
    const normalizedEventType = Array.isArray(eventType) ? eventType[0] ?? null : typeof eventType === 'string' ? eventType : null;
    if (trigger.event_types && trigger.event_types.length > 0) {
      if (!normalizedEventType || !trigger.event_types.includes(normalizedEventType)) {
        return { accepted: true, created: false, reason: 'event_filtered', event_type: normalizedEventType };
      }
    }

    verifyTriggerSignature(trigger, headers, rawBody, this.encryptionKey);
    const built = buildTriggeredWorkItem(trigger, payload, normalizedEventType);

    if (built.dedupeKey) {
      const existing = await this.pool.query<InvocationRow>(
        `SELECT id, work_item_id, status
           FROM webhook_work_item_trigger_invocations
          WHERE tenant_id = $1
            AND trigger_id = $2
            AND dedupe_key = $3
          LIMIT 1`,
        [trigger.tenant_id, trigger.id, built.dedupeKey],
      );
      if (existing.rowCount && existing.rows[0]?.status === 'created' && existing.rows[0]?.work_item_id) {
        return {
          accepted: true,
          created: false,
          duplicate: true,
          work_item_id: existing.rows[0].work_item_id,
          event_type: built.eventType,
        };
      }
    }

    const identity = triggerIdentity(trigger);
    let createdWorkItem: { id: string };
    try {
      createdWorkItem = await this.workflowService.createWorkflowWorkItem(identity, trigger.workflow_id, {
        ...built.input,
        ...(built.requestId ? { request_id: built.requestId } : {}),
      });
    } catch (error) {
      await this.recordInvocationFailure(trigger, built.eventType, built.dedupeKey, error);
      throw error;
    }

    if (built.dedupeKey) {
      await this.pool.query(
        `INSERT INTO webhook_work_item_trigger_invocations (
           tenant_id, trigger_id, event_type, dedupe_key, work_item_id, status
         ) VALUES ($1,$2,$3,$4,$5,'created')
         ON CONFLICT (trigger_id, dedupe_key) WHERE dedupe_key IS NOT NULL
         DO UPDATE
           SET work_item_id = COALESCE(webhook_work_item_trigger_invocations.work_item_id, EXCLUDED.work_item_id),
               status = 'created',
               error = NULL`,
        [trigger.tenant_id, trigger.id, built.eventType, built.dedupeKey, createdWorkItem.id],
      );
    } else {
      await this.pool.query(
        `INSERT INTO webhook_work_item_trigger_invocations (
           tenant_id, trigger_id, event_type, dedupe_key, work_item_id, status
         ) VALUES ($1,$2,$3,$4,$5,'created')`,
        [trigger.tenant_id, trigger.id, built.eventType, null, createdWorkItem.id],
      );
    }

    await this.eventService.emit({
      tenantId: trigger.tenant_id,
      type: 'trigger.fired',
      entityType: 'workflow',
      entityId: trigger.workflow_id,
      actorType: 'system',
      actorId: `trigger:${trigger.id}`,
      data: {
        trigger_id: trigger.id,
        source: trigger.source,
        workflow_id: trigger.workflow_id,
        work_item_id: createdWorkItem.id,
        event_type: built.eventType,
      },
    });

    return {
      accepted: true,
      created: true,
      work_item_id: createdWorkItem.id,
      event_type: built.eventType,
    };
  }

  private async recordInvocationFailure(
    trigger: WorkItemTriggerRow,
    eventType: string | null,
    dedupeKey: string | null,
    error: unknown,
  ) {
    const message = error instanceof Error ? error.message : 'Webhook trigger execution failed';
    if (dedupeKey) {
      await this.pool.query(
        `INSERT INTO webhook_work_item_trigger_invocations (
           tenant_id, trigger_id, event_type, dedupe_key, work_item_id, status, error
         ) VALUES ($1,$2,$3,$4,NULL,'failed',$5)
         ON CONFLICT (trigger_id, dedupe_key) WHERE dedupe_key IS NOT NULL
         DO UPDATE
           SET status = 'failed',
               error = EXCLUDED.error,
               work_item_id = NULL`,
        [trigger.tenant_id, trigger.id, eventType, dedupeKey, message],
      );
      return;
    }

    await this.pool.query(
      `INSERT INTO webhook_work_item_trigger_invocations (
         tenant_id, trigger_id, event_type, dedupe_key, work_item_id, status, error
       ) VALUES ($1,$2,$3,NULL,NULL,'failed',$4)`,
      [trigger.tenant_id, trigger.id, eventType, message],
    );
  }

  private async normalizeTriggerInput(
    tenantId: string,
    input: CreateWebhookWorkItemTriggerInput,
    currentSecret?: string,
  ) {
    const scope = await this.assertScopeTargets(tenantId, input.project_id, input.workflow_id);
    const secret = input.secret === this.decryptlessSecretSentinel(currentSecret) && currentSecret
      ? currentSecret
      : encryptWebhookSecret(input.secret, this.encryptionKey);
    const normalized = {
      name: input.name.trim(),
      source: input.source.trim(),
      project_id: scope.projectId,
      workflow_id: input.workflow_id,
      event_header: input.event_header?.trim() || null,
      event_types: input.event_types ?? [],
      signature_header: input.signature_header.trim(),
      signature_mode: input.signature_mode,
      secret,
      field_mappings: input.field_mappings ?? {},
      defaults: input.defaults ?? {},
      is_active: input.is_active ?? true,
    };
    validateTriggerDefinition(normalized);
    this.assertPlaybookDefaults(scope.definition, normalized.defaults);
    return normalized;
  }

  private async assertScopeTargets(tenantId: string, projectId: string | undefined, workflowId: string) {
    if (!workflowId) {
      throw new ValidationError('Webhook work item triggers must target a workflow');
    }

    const workflow = await this.pool.query<WorkflowScopeRow>(
      `SELECT workflows.project_id,
              workflows.playbook_id,
              playbooks.definition
         FROM workflows
         LEFT JOIN playbooks
           ON playbooks.tenant_id = workflows.tenant_id
          AND playbooks.id = workflows.playbook_id
        WHERE workflows.tenant_id = $1
          AND workflows.id = $2`,
      [tenantId, workflowId],
    );
    if (!workflow.rowCount) {
      throw new NotFoundError('Workflow not found');
    }

    const workflowRow = workflow.rows[0];
    if (!workflowRow.playbook_id || workflowRow.definition == null) {
      throw new ValidationError('Webhook work item triggers must target a playbook workflow');
    }

    const effectiveProjectId = workflowRow.project_id ?? null;
    if (projectId && effectiveProjectId && projectId !== effectiveProjectId) {
      throw new ValidationError('Workflow and project targets must belong to the same project scope');
    }

    if (projectId && !effectiveProjectId) {
      throw new ValidationError('Workflow does not belong to the provided project scope');
    }

    return {
      projectId: projectId ?? effectiveProjectId,
      definition: parsePlaybookDefinition(workflowRow.definition),
    };
  }

  private assertPlaybookDefaults(definition: ReturnType<typeof parsePlaybookDefinition>, defaults: Record<string, unknown>) {
    const stageName = readStringValue(defaults.stage_name);
    if (stageName && !hasStage(definition, stageName)) {
      throw new ValidationError('Webhook trigger default stage_name must match a playbook stage');
    }

    const columnId = readStringValue(defaults.column_id);
    if (columnId && !hasBoardColumn(definition, columnId)) {
      throw new ValidationError('Webhook trigger default column_id must match a playbook board column');
    }
  }

  private async loadTriggerRow(tenantId: string, triggerId: string) {
    const result = await this.pool.query<WorkItemTriggerRow>(
      'SELECT * FROM webhook_work_item_triggers WHERE tenant_id = $1 AND id = $2',
      [tenantId, triggerId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Webhook work item trigger not found');
    }
    return this.ensureStoredSecretEncrypted(result.rows[0]);
  }

  private async loadTriggerById(triggerId: string) {
    const result = await this.pool.query<WorkItemTriggerRow>(
      'SELECT * FROM webhook_work_item_triggers WHERE id = $1',
      [triggerId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Webhook work item trigger not found');
    }
    return this.ensureStoredSecretEncrypted(result.rows[0]);
  }

  private async ensureStoredSecretEncrypted(row: WorkItemTriggerRow): Promise<WorkItemTriggerRow> {
    if (isWebhookSecretEncrypted(row.secret)) {
      return row;
    }

    const encryptedSecret = encryptWebhookSecret(row.secret, this.encryptionKey);
    await this.pool.query(
      `UPDATE webhook_work_item_triggers
          SET secret = $3,
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [row.tenant_id, row.id, encryptedSecret],
    );

    return {
      ...row,
      secret: encryptedSecret,
      updated_at: new Date(),
    };
  }

  private decryptlessSecretSentinel(currentSecret?: string) {
    return currentSecret ? '__UNCHANGED__' : '';
  }
}

function triggerIdentity(trigger: WorkItemTriggerRow): ApiKeyIdentity {
  return {
    id: `trigger:${trigger.id}`,
    tenantId: trigger.tenant_id,
    scope: 'admin',
    ownerType: 'webhook_trigger',
    ownerId: null,
    keyPrefix: `trigger:${trigger.id}`,
  };
}

function readStringValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
