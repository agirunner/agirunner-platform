import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import {
  defaultColumnId,
  defaultStageName,
  hasBoardColumn,
  hasStage,
  parsePlaybookDefinition,
} from '../orchestration/playbook-model.js';
import { EventService } from './event-service.js';
import {
  ProjectMemoryScopeService,
  type WorkItemMemoryEntry,
  type WorkItemMemoryHistoryEntry,
} from './project-memory-scope-service.js';
import { areJsonValuesEquivalent } from './json-equivalence.js';
import { sanitizeSecretLikeValue } from './secret-redaction.js';
import { WorkflowActivationService } from './workflow-activation-service.js';
import { WorkflowActivationDispatchService } from './workflow-activation-dispatch-service.js';
import { reconcilePlannedWorkflowStages } from './workflow-stage-reconciliation.js';

export interface CreateWorkItemInput {
  request_id?: string;
  parent_work_item_id?: string;
  stage_name?: string;
  title: string;
  goal?: string;
  acceptance_criteria?: string;
  column_id?: string;
  owner_role?: string;
  priority?: 'critical' | 'high' | 'normal' | 'low';
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface ListWorkflowWorkItemsInput {
  parent_work_item_id?: string;
  stage_name?: string;
  column_id?: string;
  grouped?: boolean;
}

export interface GetWorkflowWorkItemInput {
  include_children?: boolean;
}

export interface WorkItemReadModel extends Record<string, unknown> {
  id: string;
  workflow_id: string;
  parent_work_item_id: string | null;
  stage_name: string | null;
  current_checkpoint: string | null;
  column_id: string | null;
  next_expected_actor: string | null;
  next_expected_action: string | null;
  rework_count: number;
  latest_handoff_completion?: string | null;
  unresolved_findings?: string[];
  review_focus?: string[];
  known_risks?: string[];
  gate_status?: string | null;
  gate_decision_feedback?: string | null;
  gate_decided_at?: string | Date | null;
  completed_at: string | Date | null;
  task_count: number;
  children_count: number;
  children_completed?: number;
  is_milestone: boolean;
}

export interface GroupedWorkItemReadModel extends WorkItemReadModel {
  children?: WorkItemReadModel[];
}

interface WorkflowStageContextRow {
  id: string;
  lifecycle: string | null;
  active_stage_name: string | null;
  definition: unknown;
}

export class WorkItemService {
  private readonly memoryScopeService: ProjectMemoryScopeService;

  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
    private readonly activationService: WorkflowActivationService,
    private readonly activationDispatchService: WorkflowActivationDispatchService,
  ) {
    this.memoryScopeService = new ProjectMemoryScopeService(pool);
  }

  async listWorkflowWorkItems(
    tenantId: string,
    workflowId: string,
    input: ListWorkflowWorkItemsInput = {},
  ): Promise<WorkItemReadModel[] | GroupedWorkItemReadModel[]> {
    const workItems = await this.loadWorkflowWorkItems(tenantId, workflowId, input);
    return input.grouped ? groupWorkItems(workItems) : workItems;
  }

  async getWorkflowWorkItem(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    input: GetWorkflowWorkItemInput = {},
  ): Promise<WorkItemReadModel | GroupedWorkItemReadModel> {
    const [workItem] = await this.loadWorkflowWorkItems(tenantId, workflowId, { work_item_id: workItemId });
    if (!workItem) {
      throw new NotFoundError('Workflow work item not found');
    }
    if (!input.include_children && workItem.children_count === 0) {
      return workItem;
    }
    const children = await this.loadWorkflowWorkItems(tenantId, workflowId, {
      parent_work_item_id: workItemId,
    });
    return {
      ...workItem,
      children,
    };
  }

  async listWorkItemTasks(tenantId: string, workflowId: string, workItemId: string) {
    await this.loadWorkItemContext(tenantId, workflowId, workItemId);
    const result = await this.pool.query(
      `SELECT id,
              workflow_id,
              work_item_id,
              title,
              state,
              role,
              stage_name,
              activation_id,
              is_orchestrator_task,
              created_at,
              completed_at,
              depends_on
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND work_item_id = $3
        ORDER BY created_at ASC`,
      [tenantId, workflowId, workItemId],
    );
    return result.rows.map((row) =>
      sanitizeSecretLikeValue(row, {
        redactionValue: 'redacted://work-item-secret',
        allowSecretReferences: false,
      }) as Record<string, unknown>,
    );
  }

  async listWorkItemEvents(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    limit: number,
  ): Promise<Array<Record<string, unknown>>> {
    await this.loadWorkItemContext(tenantId, workflowId, workItemId);
    const result = await this.pool.query(
      `SELECT *
         FROM events
        WHERE tenant_id = $1
          AND (
            (entity_type = 'work_item' AND entity_id = $2::uuid)
            OR (
              COALESCE(data->>'workflow_id', '') = $3
              AND COALESCE(data->>'work_item_id', '') = $4
            )
          )
        ORDER BY created_at DESC, id DESC
        LIMIT $5`,
      [tenantId, workItemId, workflowId, workItemId, limit],
    );
    return result.rows.map((row) =>
      sanitizeSecretLikeValue(row, {
        redactionValue: 'redacted://work-item-secret',
        allowSecretReferences: false,
      }) as Record<string, unknown>,
    );
  }

  async getWorkItemMemory(
    tenantId: string,
    workflowId: string,
    workItemId: string,
  ): Promise<{ entries: WorkItemMemoryEntry[] }> {
    const context = await this.loadWorkItemContext(tenantId, workflowId, workItemId);
    if (!context.project_id) {
      return { entries: [] };
    }

    const projectResult = await this.pool.query<{ memory: unknown }>(
      `SELECT memory
         FROM projects
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1`,
      [tenantId, context.project_id],
    );

    const currentMemory = asRecord(projectResult.rows[0]?.memory);
    const entries = await this.memoryScopeService.listWorkItemMemoryEntries({
      tenantId,
      projectId: context.project_id,
      workflowId,
      workItemId,
      currentMemory,
    });
    return { entries };
  }

  async getWorkItemMemoryHistory(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    limit: number,
  ): Promise<{ history: WorkItemMemoryHistoryEntry[] }> {
    const context = await this.loadWorkItemContext(tenantId, workflowId, workItemId);
    if (!context.project_id) {
      return { history: [] };
    }

    const history = await this.memoryScopeService.listWorkItemMemoryHistory({
      tenantId,
      projectId: context.project_id,
      workflowId,
      workItemId,
      limit,
    });
    return { history };
  }

  async createWorkItem(
    identity: ApiKeyIdentity,
    workflowId: string,
    input: CreateWorkItemInput,
    externalClient?: DatabaseClient,
  ) {
    if (!input.title.trim()) {
      throw new ValidationError('title is required');
    }

    const client = externalClient ?? (await this.pool.connect());
    const ownsClient = externalClient === undefined;
    try {
      if (ownsClient) {
        await client.query('BEGIN');
      }
      const workflow = await this.loadWorkflowForUpdate(identity.tenantId, workflowId, client);
      const definition = parsePlaybookDefinition(workflow.definition);
      const stageName = resolveWorkItemStageName(input.stage_name, workflow, definition);
      if (!stageName) {
        throw new ValidationError('stage_name is required for playbooks without a default stage');
      }
      if (!hasStage(definition, stageName)) {
        throw new ValidationError(`Unknown stage '${stageName}' for this playbook`);
      }

      const columnId = input.column_id ?? defaultColumnId(definition);
      if (!hasBoardColumn(definition, columnId)) {
        throw new ValidationError(`Unknown board column '${columnId}' for this playbook`);
      }

      const result = await client.query(
        `INSERT INTO workflow_work_items (
           tenant_id, workflow_id, parent_work_item_id, request_id, stage_name, current_checkpoint, title, goal,
           acceptance_criteria, column_id, owner_role, next_expected_actor, next_expected_action, rework_count,
           priority, notes, created_by, metadata
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         ON CONFLICT (tenant_id, workflow_id, request_id)
         WHERE request_id IS NOT NULL
         DO NOTHING
         RETURNING *`,
        [
          identity.tenantId,
          workflowId,
          input.parent_work_item_id ?? null,
          input.request_id ?? null,
          stageName,
          stageName,
          input.title.trim(),
          input.goal?.trim() ?? null,
          input.acceptance_criteria?.trim() ?? null,
          columnId,
          input.owner_role ?? null,
          null,
          null,
          0,
          input.priority ?? 'normal',
          input.notes?.trim() ?? null,
          createdByForIdentity(identity),
          input.metadata ?? {},
        ],
      );
      if (!result.rowCount) {
        if (!input.request_id?.trim()) {
          throw new Error('Failed to create workflow work item');
        }
        const existing = await client.query(
          `SELECT *
             FROM workflow_work_items
            WHERE tenant_id = $1
              AND workflow_id = $2
              AND request_id = $3
            LIMIT 1`,
          [identity.tenantId, workflowId, input.request_id.trim()],
        );
        if (!existing.rowCount) {
          throw new Error('Failed to load existing workflow work item after conflict');
        }
        assertMatchingCreateWorkItemReplay(existing.rows[0] as Record<string, unknown>, {
          parent_work_item_id: input.parent_work_item_id ?? null,
          stage_name: stageName,
          title: input.title.trim(),
          goal: input.goal?.trim() ?? null,
          acceptance_criteria: input.acceptance_criteria?.trim() ?? null,
          column_id: columnId,
          owner_role: input.owner_role ?? null,
          priority: input.priority ?? 'normal',
          notes: input.notes?.trim() ?? null,
          metadata: input.metadata ?? {},
        });
        if (ownsClient) {
          await client.query('COMMIT');
        }
        return toWorkItemReadModel(existing.rows[0] as Record<string, unknown>);
      }

      const workItem = result.rows[0];
      const actorType = actorTypeForIdentity(identity);

      if (workflow.lifecycle === 'planned') {
        await reconcilePlannedWorkflowStages(client, identity.tenantId, workflowId);
      }

      await this.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'work_item.created',
          entityType: 'work_item',
          entityId: workItem.id,
          actorType,
          actorId: identity.keyPrefix,
          data: {
            workflow_id: workflowId,
            work_item_id: workItem.id,
            stage_name: workItem.stage_name,
            column_id: workItem.column_id,
          },
        },
        client,
      );

      const activation = await this.activationService.enqueueForWorkflow(
        {
          tenantId: identity.tenantId,
          workflowId,
          requestId: input.request_id ? `work-item:${input.request_id}` : undefined,
          reason: 'work_item.created',
          eventType: 'work_item.created',
          payload: { work_item_id: workItem.id, stage_name: workItem.stage_name },
          actorType,
          actorId: identity.keyPrefix,
        },
        client,
      );

      await this.activationDispatchService.dispatchActivation(
        identity.tenantId,
        String(activation.id),
        client,
      );

      if (ownsClient) {
        await client.query('COMMIT');
      }
      return toWorkItemReadModel(workItem as Record<string, unknown>);
    } catch (error) {
      if (ownsClient) {
        await client.query('ROLLBACK');
      }
      throw error;
    } finally {
      if (ownsClient) {
        client.release();
      }
    }
  }

  private async loadWorkflowForUpdate(
    tenantId: string,
    workflowId: string,
    client: DatabaseClient,
  ) {
    const result = await client.query(
      `SELECT w.id,
              w.lifecycle,
              active_stage.name AS active_stage_name,
              p.definition
         FROM workflows w
         JOIN playbooks p
           ON p.tenant_id = w.tenant_id
          AND p.id = w.playbook_id
         LEFT JOIN LATERAL (
           SELECT ws.name
             FROM workflow_stages ws
            WHERE ws.tenant_id = w.tenant_id
              AND ws.workflow_id = w.id
              AND ws.status IN ('active', 'awaiting_gate', 'blocked')
            ORDER BY ws.position ASC
            LIMIT 1
        ) AS active_stage
           ON true
        WHERE w.tenant_id = $1
          AND w.id = $2
        FOR UPDATE OF w`,
      [tenantId, workflowId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Playbook workflow not found');
    }
    return result.rows[0] as WorkflowStageContextRow;
  }

  private async loadWorkItemContext(tenantId: string, workflowId: string, workItemId: string) {
    const result = await this.pool.query<{ id: string; workflow_id: string; project_id: string | null }>(
      `SELECT wi.id, wi.workflow_id, w.project_id
         FROM workflow_work_items wi
         JOIN workflows w
           ON w.tenant_id = wi.tenant_id
          AND w.id = wi.workflow_id
        WHERE wi.tenant_id = $1
          AND wi.workflow_id = $2
          AND wi.id = $3
        LIMIT 1`,
      [tenantId, workflowId, workItemId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workflow work item not found');
    }
    return result.rows[0];
  }

  private async loadWorkflowWorkItems(
    tenantId: string,
    workflowId: string,
    input: ListWorkflowWorkItemsInput & { work_item_id?: string } = {},
  ) {
    const values: unknown[] = [tenantId, workflowId];
    const conditions = ['wi.tenant_id = $1', 'wi.workflow_id = $2'];

    if (input.work_item_id) {
      values.push(input.work_item_id);
      conditions.push(`wi.id = $${values.length}`);
    }
    if (input.parent_work_item_id) {
      values.push(input.parent_work_item_id);
      conditions.push(`wi.parent_work_item_id = $${values.length}`);
    }
    if (input.stage_name) {
      values.push(input.stage_name);
      conditions.push(`wi.stage_name = $${values.length}`);
    }
    if (input.column_id) {
      values.push(input.column_id);
      conditions.push(`wi.column_id = $${values.length}`);
    }

    const result = await this.pool.query(
      `SELECT wi.*,
              COUNT(DISTINCT t.id)::int AS task_count,
              COUNT(DISTINCT child.id)::int AS children_count,
              COUNT(DISTINCT child.id) FILTER (WHERE child.completed_at IS NOT NULL)::int AS children_completed,
              latest_handoff.latest_handoff_completion,
              latest_handoff.unresolved_findings,
              latest_handoff.review_focus,
              latest_handoff.known_risks,
              latest_gate.gate_status,
              latest_gate.gate_decision_feedback,
              latest_gate.gate_decided_at
         FROM workflow_work_items wi
         LEFT JOIN tasks t
           ON t.tenant_id = wi.tenant_id
          AND t.work_item_id = wi.id
         LEFT JOIN workflow_work_items child
           ON child.tenant_id = wi.tenant_id
          AND child.parent_work_item_id = wi.id
         LEFT JOIN workflow_stages ws
           ON ws.tenant_id = wi.tenant_id
          AND ws.workflow_id = wi.workflow_id
          AND ws.name = COALESCE(wi.current_checkpoint, wi.stage_name)
         LEFT JOIN LATERAL (
           SELECT th.completion AS latest_handoff_completion,
                  array_cat(
                    COALESCE(
                      ARRAY(SELECT jsonb_array_elements_text(COALESCE(th.remaining_items, '[]'::jsonb))),
                      ARRAY[]::text[]
                    ),
                    COALESCE(
                      ARRAY(SELECT jsonb_array_elements_text(COALESCE(th.blockers, '[]'::jsonb))),
                      ARRAY[]::text[]
                    )
                  ) AS unresolved_findings,
                  th.review_focus,
                  th.known_risks
             FROM task_handoffs th
            WHERE th.tenant_id = wi.tenant_id
              AND th.workflow_id = wi.workflow_id
              AND th.work_item_id = wi.id
            ORDER BY th.sequence DESC, th.created_at DESC
            LIMIT 1
         ) latest_handoff ON true
         LEFT JOIN LATERAL (
           SELECT g.status AS gate_status,
                  g.decision_feedback AS gate_decision_feedback,
                  g.decided_at AS gate_decided_at
             FROM workflow_stage_gates g
            WHERE g.tenant_id = wi.tenant_id
              AND g.workflow_id = wi.workflow_id
              AND g.stage_id = ws.id
            ORDER BY g.requested_at DESC, g.created_at DESC
            LIMIT 1
         ) latest_gate ON true
        WHERE ${conditions.join(' AND ')}
        GROUP BY wi.id,
                 latest_handoff.latest_handoff_completion,
                 latest_handoff.unresolved_findings,
                 latest_handoff.review_focus,
                 latest_handoff.known_risks,
                 latest_gate.gate_status,
                 latest_gate.gate_decision_feedback,
                 latest_gate.gate_decided_at
        ORDER BY wi.created_at ASC`,
      values,
    );
    return result.rows.map(toWorkItemReadModel);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function resolveWorkItemStageName(
  inputStageName: string | undefined,
  workflow: { lifecycle: string | null; active_stage_name: string | null },
  definition: ReturnType<typeof parsePlaybookDefinition>,
): string | null {
  if (inputStageName) {
    return inputStageName;
  }
  if (workflow.lifecycle === 'ongoing') {
    return defaultStageName(definition);
  }
  return (workflow.active_stage_name as string | null) ?? defaultStageName(definition);
}

function createdByForIdentity(identity: ApiKeyIdentity): 'api' | 'manual' | 'orchestrator' | 'webhook' {
  if (identity.ownerType === 'webhook_trigger' || identity.ownerType === 'scheduled_trigger') {
    return 'webhook';
  }
  if (identity.ownerType === 'agent') {
    return 'orchestrator';
  }
  return identity.scope === 'admin' ? 'manual' : 'api';
}

function actorTypeForIdentity(identity: ApiKeyIdentity): string {
  return identity.ownerType === 'webhook_trigger' || identity.ownerType === 'scheduled_trigger'
    ? 'system'
    : identity.scope;
}

function toWorkItemReadModel(row: Record<string, unknown>): WorkItemReadModel {
  const sanitizedRow = sanitizeSecretLikeValue(row, {
    redactionValue: 'redacted://work-item-secret',
    allowSecretReferences: false,
  }) as Record<string, unknown>;
  const childrenCount = readCount(sanitizedRow.children_count);
  return {
    ...sanitizedRow,
    id: String(sanitizedRow.id ?? ''),
    workflow_id: String(sanitizedRow.workflow_id ?? ''),
    parent_work_item_id: typeof sanitizedRow.parent_work_item_id === 'string' ? sanitizedRow.parent_work_item_id : null,
    stage_name: typeof sanitizedRow.stage_name === 'string' ? sanitizedRow.stage_name : null,
    current_checkpoint:
      typeof sanitizedRow.current_checkpoint === 'string' ? sanitizedRow.current_checkpoint : null,
    column_id: typeof sanitizedRow.column_id === 'string' ? sanitizedRow.column_id : null,
    next_expected_actor:
      typeof sanitizedRow.next_expected_actor === 'string' ? sanitizedRow.next_expected_actor : null,
    next_expected_action:
      typeof sanitizedRow.next_expected_action === 'string' ? sanitizedRow.next_expected_action : null,
    rework_count: readCount(sanitizedRow.rework_count),
    latest_handoff_completion:
      typeof sanitizedRow.latest_handoff_completion === 'string'
        ? sanitizedRow.latest_handoff_completion
        : null,
    unresolved_findings: readStringArray(sanitizedRow.unresolved_findings),
    review_focus: readStringArray(sanitizedRow.review_focus),
    known_risks: readStringArray(sanitizedRow.known_risks),
    gate_status: typeof sanitizedRow.gate_status === 'string' ? sanitizedRow.gate_status : null,
    gate_decision_feedback:
      typeof sanitizedRow.gate_decision_feedback === 'string'
        ? sanitizedRow.gate_decision_feedback
        : null,
    gate_decided_at:
      typeof sanitizedRow.gate_decided_at === 'string' || sanitizedRow.gate_decided_at instanceof Date
        ? sanitizedRow.gate_decided_at
        : null,
    completed_at:
      typeof sanitizedRow.completed_at === 'string' || sanitizedRow.completed_at instanceof Date
        ? sanitizedRow.completed_at
        : null,
    task_count: readCount(sanitizedRow.task_count),
    children_count: childrenCount,
    children_completed: readCount(sanitizedRow.children_completed),
    is_milestone: childrenCount > 0,
  } as WorkItemReadModel;
}

function groupWorkItems(workItems: WorkItemReadModel[]): GroupedWorkItemReadModel[] {
  const grouped = new Map<string, GroupedWorkItemReadModel>();
  const roots: GroupedWorkItemReadModel[] = [];

  for (const item of workItems) {
    grouped.set(String(item.id), { ...item });
  }

  for (const item of grouped.values()) {
    const parentId = typeof item.parent_work_item_id === 'string' ? item.parent_work_item_id : null;
    if (!parentId) {
      roots.push(item);
      continue;
    }
    const parent = grouped.get(parentId);
    if (!parent) {
      roots.push(item);
      continue;
    }
    const existingChildren = Array.isArray(parent.children)
      ? (parent.children as WorkItemReadModel[])
      : [];
    const children = [...existingChildren, item] as WorkItemReadModel[];
    parent.children = children;
  }

  return roots;
}

function readCount(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

function assertMatchingCreateWorkItemReplay(
  existing: Record<string, unknown>,
  expected: {
    parent_work_item_id: string | null;
    stage_name: string;
    title: string;
    goal: string | null;
    acceptance_criteria: string | null;
    column_id: string;
    owner_role: string | null;
    priority: string;
    notes: string | null;
    metadata: Record<string, unknown>;
  },
): void {
  if (
    (existing.parent_work_item_id ?? null) !== expected.parent_work_item_id ||
    existing.stage_name !== expected.stage_name ||
    existing.title !== expected.title ||
    (existing.goal ?? null) !== expected.goal ||
    (existing.acceptance_criteria ?? null) !== expected.acceptance_criteria ||
    existing.column_id !== expected.column_id ||
    (existing.owner_role ?? null) !== expected.owner_role ||
    existing.priority !== expected.priority ||
    (existing.notes ?? null) !== expected.notes ||
    !areJsonValuesEquivalent(asRecord(existing.metadata), expected.metadata)
  ) {
    throw new ConflictError('work item request_id replay does not match the existing work item');
  }
}
