import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import { hasBoardColumn, hasStage, parsePlaybookDefinition } from '../orchestration/playbook-model.js';
import { EventService } from './event-service.js';
import {
  computeInitialScheduledFireAt,
  toPublicScheduledTrigger,
  validateScheduledTriggerDefinition,
  type ScheduledTriggerScheduleType,
  type ScheduledWorkItemTriggerRow,
} from './scheduled-work-item-trigger-helpers.js';
import {
  ScheduledWorkItemTriggerExecutor,
  type FireDueScheduledWorkItemTriggersResult,
} from './scheduled-work-item-trigger-executor.js';
import type { WorkflowService } from './workflow-service.js';

interface WorkflowScopeRow {
  project_id: string | null;
  playbook_id: string | null;
  definition: unknown;
}

export interface CreateScheduledWorkItemTriggerInput {
  name: string;
  source?: string | null;
  project_id?: string;
  workflow_id: string;
  schedule_type?: ScheduledTriggerScheduleType | null;
  cadence_minutes?: number | null;
  daily_time?: string | null;
  timezone?: string | null;
  defaults?: Record<string, unknown>;
  is_active?: boolean;
  next_fire_at?: string;
}

export interface UpdateScheduledWorkItemTriggerInput {
  name?: string;
  source?: string | null;
  project_id?: string | null;
  workflow_id?: string;
  schedule_type?: ScheduledTriggerScheduleType | null;
  cadence_minutes?: number | null;
  daily_time?: string | null;
  timezone?: string | null;
  defaults?: Record<string, unknown>;
  is_active?: boolean;
  next_fire_at?: string;
}

export class ScheduledWorkItemTriggerService {
  private readonly executor: ScheduledWorkItemTriggerExecutor;

  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
    private readonly workflowService: WorkflowService,
  ) {
    this.executor = new ScheduledWorkItemTriggerExecutor(pool, eventService, workflowService);
  }

  async createTrigger(identity: ApiKeyIdentity, input: CreateScheduledWorkItemTriggerInput) {
    const normalized = await this.normalizeTriggerInput(identity.tenantId, input);
    const result = await this.pool.query<ScheduledWorkItemTriggerRow>(
      `INSERT INTO scheduled_work_item_triggers (
         tenant_id, name, source, project_id, workflow_id, schedule_type, cadence_minutes, daily_time, timezone, defaults, is_active, next_fire_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
       RETURNING *`,
      [
        identity.tenantId,
        normalized.name,
        normalized.source,
        normalized.project_id,
        normalized.workflow_id,
        normalized.schedule_type,
        normalized.cadence_minutes,
        normalized.daily_time,
        normalized.timezone,
        normalized.defaults,
        normalized.is_active,
        normalized.next_fire_at,
      ],
    );

    await this.eventService.emit({
      tenantId: identity.tenantId,
      type: 'trigger.created',
      entityType: 'workflow',
      entityId: normalized.workflow_id,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: {
        trigger_id: result.rows[0].id,
        source: normalized.source,
        trigger_kind: 'schedule',
      },
    });

    return toPublicScheduledTrigger(result.rows[0]);
  }

  async updateTrigger(tenantId: string, triggerId: string, input: UpdateScheduledWorkItemTriggerInput) {
    const current = await this.loadTriggerRow(tenantId, triggerId);
    const normalized = await this.normalizeTriggerInput(tenantId, {
      name: input.name ?? current.name,
      source: input.source ?? current.source,
      project_id: input.project_id === undefined ? current.project_id ?? undefined : input.project_id ?? undefined,
      workflow_id: input.workflow_id ?? current.workflow_id,
      schedule_type: input.schedule_type ?? current.schedule_type,
      cadence_minutes: input.cadence_minutes ?? current.cadence_minutes,
      daily_time: input.daily_time ?? current.daily_time,
      timezone: input.timezone ?? current.timezone,
      defaults: input.defaults ?? current.defaults ?? {},
      is_active: input.is_active ?? current.is_active,
      next_fire_at: input.next_fire_at,
    });

    const result = await this.pool.query<ScheduledWorkItemTriggerRow>(
      `UPDATE scheduled_work_item_triggers
          SET name = $3,
              source = $4,
              project_id = $5,
              workflow_id = $6,
              schedule_type = $7,
              cadence_minutes = $8,
              daily_time = $9,
              timezone = $10,
              defaults = $11::jsonb,
              is_active = $12,
              next_fire_at = $13,
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
        normalized.schedule_type,
        normalized.cadence_minutes,
        normalized.daily_time,
        normalized.timezone,
        normalized.defaults,
        normalized.is_active,
        normalized.next_fire_at,
      ],
    );

    return toPublicScheduledTrigger(result.rows[0]);
  }

  async listTriggers(tenantId: string) {
    const result = await this.pool.query<ScheduledWorkItemTriggerRow>(
      `SELECT *
         FROM scheduled_work_item_triggers
        WHERE tenant_id = $1
        ORDER BY created_at DESC`,
      [tenantId],
    );
    return { data: result.rows.map(toPublicScheduledTrigger) };
  }

  async deleteTrigger(tenantId: string, triggerId: string) {
    await this.pool.query(
      'DELETE FROM scheduled_work_item_trigger_invocations WHERE tenant_id = $1 AND trigger_id = $2',
      [tenantId, triggerId],
    );
    const result = await this.pool.query(
      'DELETE FROM scheduled_work_item_triggers WHERE tenant_id = $1 AND id = $2 RETURNING id',
      [tenantId, triggerId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Scheduled work item trigger not found');
    }
    return { id: triggerId, deleted: true };
  }

  async fireDueTriggers(now = new Date()): Promise<FireDueScheduledWorkItemTriggersResult> {
    return this.executor.fireDueTriggers(now);
  }

  private async normalizeTriggerInput(
    tenantId: string,
    input: CreateScheduledWorkItemTriggerInput,
    now = new Date(),
  ) {
    const scope = await this.assertScopeTargets(tenantId, input.project_id, input.workflow_id);
    const scheduleType = input.schedule_type === 'daily_time' ? 'daily_time' : 'interval';
    const dailyTime = scheduleType === 'daily_time' ? readStringValue(input.daily_time) : null;
    const timezone = scheduleType === 'daily_time' ? readStringValue(input.timezone) : null;
    const normalizedSource = normalizeProjectScheduleSource(scope.projectId, input.source);
    const normalized = {
      name: input.name.trim(),
      source: normalizedSource,
      project_id: scope.projectId,
      workflow_id: input.workflow_id,
      schedule_type: scheduleType as ScheduledTriggerScheduleType,
      cadence_minutes: scheduleType === 'interval' ? input.cadence_minutes ?? null : null,
      daily_time: dailyTime,
      timezone,
      defaults: input.defaults ?? {},
      is_active: input.is_active ?? true,
      next_fire_at: now,
    };
    validateScheduledTriggerDefinition(normalized);
    normalized.next_fire_at = resolveNextFireAt(input.next_fire_at, normalized, now);
    this.assertPlaybookDefaults(scope.definition, normalized.defaults);
    return normalized;
  }

  private async assertScopeTargets(tenantId: string, projectId: string | undefined, workflowId: string) {
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
      throw new ValidationError('Scheduled work item triggers must target a playbook workflow');
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
      throw new ValidationError('Scheduled trigger default stage_name must match a playbook stage');
    }

    const columnId = readStringValue(defaults.column_id);
    if (columnId && !hasBoardColumn(definition, columnId)) {
      throw new ValidationError('Scheduled trigger default column_id must match a playbook board column');
    }
  }

  private async loadTriggerRow(tenantId: string, triggerId: string) {
    const result = await this.pool.query<ScheduledWorkItemTriggerRow>(
      'SELECT * FROM scheduled_work_item_triggers WHERE tenant_id = $1 AND id = $2',
      [tenantId, triggerId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Scheduled work item trigger not found');
    }
    return result.rows[0];
  }
}

function parseNextFireAt(value: string | undefined): Date {
  const parsed = new Date(value ?? '');
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError('next_fire_at must be a valid ISO-8601 timestamp');
  }
  return parsed;
}

function resolveNextFireAt(
  explicitValue: string | undefined,
  schedule: {
    schedule_type: ScheduledTriggerScheduleType;
    cadence_minutes?: number | null;
    daily_time?: string | null;
    timezone?: string | null;
  },
  now: Date,
) {
  if (explicitValue) {
    return parseNextFireAt(explicitValue);
  }
  return computeInitialScheduledFireAt(schedule, now);
}

function normalizeProjectScheduleSource(projectId: string | null, source?: string | null) {
  const trimmed = typeof source === 'string' ? source.trim() : '';
  if (projectId) {
    return 'project.schedule';
  }
  return trimmed || 'project.schedule';
}

function readStringValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
