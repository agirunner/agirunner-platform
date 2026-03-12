import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
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
import { WorkflowActivationService } from './workflow-activation-service.js';
import { WorkflowActivationDispatchService } from './workflow-activation-dispatch-service.js';

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
  column_id: string | null;
  completed_at: string | Date | null;
  task_count: number;
  children_count: number;
  children_completed?: number;
  is_milestone: boolean;
}

export interface GroupedWorkItemReadModel extends WorkItemReadModel {
  children?: WorkItemReadModel[];
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
    return result.rows;
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
    return result.rows;
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
           tenant_id, workflow_id, parent_work_item_id, request_id, stage_name, title, goal,
           acceptance_criteria, column_id, owner_role, priority, notes, created_by, metadata
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
          input.title.trim(),
          input.goal?.trim() ?? null,
          input.acceptance_criteria?.trim() ?? null,
          columnId,
          input.owner_role ?? null,
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
        if (ownsClient) {
          await client.query('COMMIT');
        }
        return existing.rows[0];
      }

      const workItem = result.rows[0];
      const actorType = actorTypeForIdentity(identity);

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
      return workItem;
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
      `SELECT w.id, w.lifecycle, w.current_stage, p.definition
         FROM workflows w
         JOIN playbooks p
           ON p.tenant_id = w.tenant_id
          AND p.id = w.playbook_id
        WHERE w.tenant_id = $1
          AND w.id = $2
        FOR UPDATE`,
      [tenantId, workflowId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Playbook workflow not found');
    }
    return result.rows[0] as { id: string; current_stage: string | null; definition: unknown };
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
              COUNT(DISTINCT child.id)::int AS children_count
         FROM workflow_work_items wi
         LEFT JOIN tasks t
           ON t.tenant_id = wi.tenant_id
          AND t.work_item_id = wi.id
         LEFT JOIN workflow_work_items child
           ON child.tenant_id = wi.tenant_id
          AND child.parent_work_item_id = wi.id
        WHERE ${conditions.join(' AND ')}
        GROUP BY wi.id
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
  workflow: Record<string, unknown>,
  definition: ReturnType<typeof parsePlaybookDefinition>,
): string | null {
  if (inputStageName) {
    return inputStageName;
  }
  if (workflow.lifecycle === 'continuous') {
    return defaultStageName(definition);
  }
  return (workflow.current_stage as string | null) ?? defaultStageName(definition);
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
  const childrenCount = readCount(row.children_count);
  return {
    ...row,
    id: String(row.id ?? ''),
    workflow_id: String(row.workflow_id ?? ''),
    parent_work_item_id: typeof row.parent_work_item_id === 'string' ? row.parent_work_item_id : null,
    stage_name: typeof row.stage_name === 'string' ? row.stage_name : null,
    column_id: typeof row.column_id === 'string' ? row.column_id : null,
    completed_at:
      typeof row.completed_at === 'string' || row.completed_at instanceof Date
        ? row.completed_at
        : null,
    task_count: readCount(row.task_count),
    children_count: childrenCount,
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
