import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import { NotFoundError } from '../../errors/domain-errors.js';
import {
  CANCELLABLE_WORKFLOW_STATES,
  TERMINAL_TASK_STATES,
  TERMINAL_WORKFLOW_STATES,
  type DeleteImpactSummary,
} from './destructive-delete-types.js';

type Queryable = Pick<DatabasePool, 'query'> | Pick<DatabaseClient, 'query'>;

export async function summarizePlaybookScope(
  db: Queryable,
  tenantId: string,
  playbookIds: string[],
): Promise<DeleteImpactSummary> {
  const result = await db.query<DeleteImpactSummary>(
    `SELECT
       (SELECT COUNT(*)::int
          FROM workflows
         WHERE tenant_id = $1
           AND playbook_id = ANY($2::uuid[])) AS workflows,
       (SELECT COUNT(*)::int
          FROM workflows
         WHERE tenant_id = $1
           AND playbook_id = ANY($2::uuid[])
           AND state::text <> ALL($3::text[])) AS active_workflows,
       (SELECT COUNT(*)::int
          FROM tasks
         WHERE tenant_id = $1
           AND workflow_id IN (
             SELECT id
               FROM workflows
              WHERE tenant_id = $1
                AND playbook_id = ANY($2::uuid[])
           )) AS tasks,
       (SELECT COUNT(*)::int
          FROM tasks
         WHERE tenant_id = $1
           AND workflow_id IN (
             SELECT id
               FROM workflows
              WHERE tenant_id = $1
                AND playbook_id = ANY($2::uuid[])
           )
           AND state::text <> ALL($4::text[])) AS active_tasks,
       (SELECT COUNT(*)::int
          FROM workflow_work_items
         WHERE tenant_id = $1
           AND workflow_id IN (
             SELECT id
               FROM workflows
              WHERE tenant_id = $1
                AND playbook_id = ANY($2::uuid[])
           )) AS work_items`,
    [tenantId, playbookIds, [...TERMINAL_WORKFLOW_STATES], [...TERMINAL_TASK_STATES]],
  );
  return result.rows[0] ?? emptyImpactSummary();
}

export async function summarizeWorkspaceScope(
  db: Queryable,
  tenantId: string,
  workspaceId: string,
): Promise<DeleteImpactSummary> {
  const result = await db.query<DeleteImpactSummary>(
    `SELECT
       (SELECT COUNT(*)::int
          FROM workflows
         WHERE tenant_id = $1
           AND workspace_id = $2) AS workflows,
       (SELECT COUNT(*)::int
          FROM workflows
         WHERE tenant_id = $1
           AND workspace_id = $2
           AND state::text <> ALL($3::text[])) AS active_workflows,
       (SELECT COUNT(*)::int
          FROM tasks
         WHERE tenant_id = $1
           AND workspace_id = $2) AS tasks,
       (SELECT COUNT(*)::int
          FROM tasks
         WHERE tenant_id = $1
           AND workspace_id = $2
           AND state::text <> ALL($4::text[])) AS active_tasks,
       (SELECT COUNT(*)::int
          FROM workflow_work_items
         WHERE tenant_id = $1
           AND workflow_id IN (
             SELECT id
               FROM workflows
              WHERE tenant_id = $1
                AND workspace_id = $2
           )) AS work_items`,
    [tenantId, workspaceId, [...TERMINAL_WORKFLOW_STATES], [...TERMINAL_TASK_STATES]],
  );
  return result.rows[0] ?? emptyImpactSummary();
}

export async function loadPlaybook(
  db: Queryable,
  tenantId: string,
  playbookId: string,
): Promise<{ id: string; slug: string }> {
  const result = await db.query<{ id: string; slug: string }>(
    `SELECT id, slug
       FROM playbooks
      WHERE tenant_id = $1
        AND id = $2`,
    [tenantId, playbookId],
  );
  const playbook = result.rows[0];
  if (!playbook) {
    throw new NotFoundError('Playbook not found');
  }
  return playbook;
}

export async function assertWorkspaceExists(
  db: Queryable,
  tenantId: string,
  workspaceId: string,
): Promise<void> {
  const result = await db.query<{ id: string }>(
    `SELECT id
       FROM workspaces
      WHERE tenant_id = $1
        AND id = $2`,
    [tenantId, workspaceId],
  );
  if (!result.rowCount) {
    throw new NotFoundError('Workspace not found');
  }
}

export async function listPlaybookFamilyIds(
  db: Queryable,
  tenantId: string,
  slug: string,
): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `SELECT id
       FROM playbooks
      WHERE tenant_id = $1
        AND slug = $2`,
    [tenantId, slug],
  );
  return result.rows.map((row) => row.id);
}

export async function listWorkflowIdsForPlaybooks(
  db: Queryable,
  tenantId: string,
  playbookIds: string[],
): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `SELECT id
       FROM workflows
      WHERE tenant_id = $1
        AND playbook_id = ANY($2::uuid[])`,
    [tenantId, uniqueIds(playbookIds)],
  );
  return result.rows.map((row) => row.id);
}

export async function listActiveWorkflowIdsForPlaybooks(
  db: Queryable,
  tenantId: string,
  playbookIds: string[],
): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `SELECT id
       FROM workflows
      WHERE tenant_id = $1
        AND playbook_id = ANY($2::uuid[])
        AND state::text = ANY($3::text[])`,
    [tenantId, uniqueIds(playbookIds), [...CANCELLABLE_WORKFLOW_STATES]],
  );
  return result.rows.map((row) => row.id);
}

export async function listWorkflowIdsForSelection(
  db: Queryable,
  tenantId: string,
  workflowIds: string[],
): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `SELECT id
       FROM workflows
      WHERE tenant_id = $1
        AND id = ANY($2::uuid[])`,
    [tenantId, uniqueIds(workflowIds)],
  );
  return result.rows.map((row) => row.id);
}

export async function listActiveWorkflowIdsForSelection(
  db: Queryable,
  tenantId: string,
  workflowIds: string[],
): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `SELECT id
       FROM workflows
      WHERE tenant_id = $1
        AND id = ANY($2::uuid[])
        AND state::text = ANY($3::text[])`,
    [tenantId, uniqueIds(workflowIds), [...CANCELLABLE_WORKFLOW_STATES]],
  );
  return result.rows.map((row) => row.id);
}

export async function listWorkflowIdsForWorkspace(
  db: Queryable,
  tenantId: string,
  workspaceId: string,
): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `SELECT id
       FROM workflows
      WHERE tenant_id = $1
        AND workspace_id = $2`,
    [tenantId, workspaceId],
  );
  return result.rows.map((row) => row.id);
}

export async function listActiveWorkflowIdsForWorkspace(
  db: Queryable,
  tenantId: string,
  workspaceId: string,
): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `SELECT id
       FROM workflows
      WHERE tenant_id = $1
        AND workspace_id = $2
        AND state::text = ANY($3::text[])`,
    [tenantId, workspaceId, [...CANCELLABLE_WORKFLOW_STATES]],
  );
  return result.rows.map((row) => row.id);
}

export async function listTaskIdsForWorkflows(
  db: Queryable,
  tenantId: string,
  workflowIds: string[],
): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `SELECT id
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = ANY($2::uuid[])`,
    [tenantId, uniqueIds(workflowIds)],
  );
  return result.rows.map((row) => row.id);
}

export async function listTaskIdsForWorkspace(
  db: Queryable,
  tenantId: string,
  workspaceId: string,
): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `SELECT id
       FROM tasks
      WHERE tenant_id = $1
        AND workspace_id = $2`,
    [tenantId, workspaceId],
  );
  return result.rows.map((row) => row.id);
}

export async function listActiveStandaloneTaskIdsForWorkspace(
  db: Queryable,
  tenantId: string,
  workspaceId: string,
): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `SELECT id
       FROM tasks
      WHERE tenant_id = $1
        AND workspace_id = $2
        AND workflow_id IS NULL
        AND state::text <> ALL($3::text[])`,
    [tenantId, workspaceId, [...TERMINAL_TASK_STATES]],
  );
  return result.rows.map((row) => row.id);
}

export function uniqueIds(values: string[]): string[] {
  return Array.from(new Set(values));
}

function emptyImpactSummary(): DeleteImpactSummary {
  return {
    workflows: 0,
    active_workflows: 0,
    tasks: 0,
    active_tasks: 0,
    work_items: 0,
  };
}
