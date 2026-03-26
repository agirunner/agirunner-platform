import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';

const TERMINAL_WORKFLOW_STATES = ['completed', 'failed', 'cancelled'] as const;
const TERMINAL_TASK_STATES = ['completed', 'failed', 'cancelled'] as const;

export interface DeleteImpactSummary {
  workflows: number;
  active_workflows: number;
  tasks: number;
  active_tasks: number;
  work_items: number;
}

export interface PlaybookDeleteImpact {
  revision: DeleteImpactSummary;
  family: DeleteImpactSummary & { revisions: number };
}

interface DestructiveDeleteDeps {
  cancelWorkflow?: (identity: ApiKeyIdentity, workflowId: string) => Promise<unknown>;
  cancelTask?: (identity: ApiKeyIdentity, taskId: string) => Promise<unknown>;
}

export class DestructiveDeleteService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly deps: DestructiveDeleteDeps = {},
  ) {}

  async getPlaybookDeleteImpact(tenantId: string, playbookId: string): Promise<PlaybookDeleteImpact> {
    const playbook = await this.loadPlaybook(tenantId, playbookId);
    const familyIds = await this.listPlaybookFamilyIds(this.pool, tenantId, playbook.slug);

    return {
      revision: await this.summarizePlaybookScope(tenantId, [playbookId]),
      family: {
        revisions: familyIds.length,
        ...(await this.summarizePlaybookScope(tenantId, familyIds)),
      },
    };
  }

  async getWorkspaceDeleteImpact(tenantId: string, workspaceId: string): Promise<DeleteImpactSummary> {
    await this.assertWorkspaceExists(tenantId, workspaceId);
    return this.summarizeWorkspaceScope(tenantId, workspaceId);
  }

  async deletePlaybookPermanently(identity: ApiKeyIdentity, playbookId: string) {
    const playbook = await this.loadPlaybook(identity.tenantId, playbookId);
    const familyIds = await this.listPlaybookFamilyIds(this.pool, identity.tenantId, playbook.slug);
    const activeWorkflowIds = await this.listActiveWorkflowIdsForPlaybooks(
      this.pool,
      identity.tenantId,
      familyIds,
    );
    await this.cancelWorkflows(identity, activeWorkflowIds);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const workflowIds = await this.listWorkflowIdsForPlaybooks(client, identity.tenantId, familyIds);
      const taskIds = await this.listTaskIdsForWorkflows(client, identity.tenantId, workflowIds);
      const purgeCounts = await this.purgeWorkflowTree(client, identity.tenantId, workflowIds, taskIds);
      const deletedPlaybooks = await client.query<{ id: string }>(
        `DELETE FROM playbooks
          WHERE tenant_id = $1
            AND slug = $2
        RETURNING id`,
        [identity.tenantId, playbook.slug],
      );
      await client.query('COMMIT');
      return {
        id: playbookId,
        deleted: true as const,
        deleted_revision_count: deletedPlaybooks.rowCount ?? 0,
        deleted_workflow_count: purgeCounts.deleted_workflow_count,
        deleted_task_count: purgeCounts.deleted_task_count,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteWorkspaceCascading(identity: ApiKeyIdentity, workspaceId: string) {
    await this.assertWorkspaceExists(identity.tenantId, workspaceId);
    const activeWorkflowIds = await this.listActiveWorkflowIdsForWorkspace(
      this.pool,
      identity.tenantId,
      workspaceId,
    );
    const activeStandaloneTaskIds = await this.listActiveStandaloneTaskIdsForWorkspace(
      this.pool,
      identity.tenantId,
      workspaceId,
    );
    await this.cancelWorkflows(identity, activeWorkflowIds);
    await this.cancelTasks(identity, activeStandaloneTaskIds);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const workflowIds = await this.listWorkflowIdsForWorkspace(client, identity.tenantId, workspaceId);
      const taskIds = await this.listTaskIdsForWorkspace(client, identity.tenantId, workspaceId);
      const purgeCounts = await this.purgeWorkflowTree(
        client,
        identity.tenantId,
        workflowIds,
        taskIds,
        workspaceId,
      );
      await client.query(
        `DELETE FROM workspace_spec_versions
          WHERE tenant_id = $1
            AND workspace_id = $2`,
        [identity.tenantId, workspaceId],
      );
      await client.query(
        `DELETE FROM workspace_artifact_files
          WHERE tenant_id = $1
            AND workspace_id = $2`,
        [identity.tenantId, workspaceId],
      );
      await client.query(
        `DELETE FROM workspaces
          WHERE tenant_id = $1
            AND id = $2`,
        [identity.tenantId, workspaceId],
      );
      await client.query('COMMIT');
      return {
        id: workspaceId,
        deleted: true as const,
        deleted_workflow_count: purgeCounts.deleted_workflow_count,
        deleted_task_count: purgeCounts.deleted_task_count,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async summarizePlaybookScope(tenantId: string, playbookIds: string[]): Promise<DeleteImpactSummary> {
    const result = await this.pool.query<DeleteImpactSummary>(
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

  private async summarizeWorkspaceScope(tenantId: string, workspaceId: string): Promise<DeleteImpactSummary> {
    const result = await this.pool.query<DeleteImpactSummary>(
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

  private async purgeWorkflowTree(
    client: DatabaseClient,
    tenantId: string,
    workflowIds: string[],
    taskIds: string[],
    workspaceId?: string,
  ) {
    const uniqueWorkflowIds = uniqueIds(workflowIds);
    const uniqueTaskIds = uniqueIds(taskIds);
    const workflowParams = [tenantId, uniqueWorkflowIds];
    const taskParams = [tenantId, uniqueTaskIds];
    const workflowTaskParams = [tenantId, uniqueWorkflowIds, uniqueTaskIds];
    const workflowWorkspaceParams = [tenantId, uniqueWorkflowIds, workspaceId ?? null];
    const workflowTaskWorkspaceParams = [tenantId, uniqueWorkflowIds, uniqueTaskIds, workspaceId ?? null];
    await client.query(
      `UPDATE agents
          SET current_task_id = NULL,
              status = (CASE WHEN status = 'inactive' THEN 'inactive' ELSE 'idle' END)::agent_status
        WHERE tenant_id = $1
          AND current_task_id = ANY($2::uuid[])`,
      taskParams,
    );
    await client.query(
      `UPDATE workers
          SET current_task_id = NULL
        WHERE tenant_id = $1
          AND current_task_id = ANY($2::uuid[])`,
      taskParams,
    );
    await client.query('DELETE FROM integration_actions WHERE tenant_id = $1 AND task_id = ANY($2::uuid[])', taskParams);
    await client.query('DELETE FROM worker_signals WHERE tenant_id = $1 AND task_id = ANY($2::uuid[])', taskParams);
    await client.query(
      `DELETE FROM task_handoffs
        WHERE tenant_id = $1
          AND (task_id = ANY($3::uuid[]) OR workflow_id = ANY($2::uuid[]))`,
      workflowTaskParams,
    );
    await client.query('DELETE FROM task_tool_results WHERE tenant_id = $1 AND task_id = ANY($2::uuid[])', taskParams);
    await client.query('DELETE FROM execution_container_leases WHERE tenant_id = $1 AND task_id = ANY($2::uuid[])', taskParams);
    await client.query(
      `DELETE FROM orchestrator_task_messages
        WHERE tenant_id = $1
          AND (
            task_id = ANY($3::uuid[])
            OR orchestrator_task_id = ANY($3::uuid[])
            OR workflow_id = ANY($2::uuid[])
          )`,
      workflowTaskParams,
    );
    await client.query(
      `DELETE FROM workflow_subject_escalations
        WHERE tenant_id = $1
          AND (
            workflow_id = ANY($2::uuid[])
            OR created_by_task_id = ANY($3::uuid[])
            OR resolved_by_task_id = ANY($3::uuid[])
          )`,
      workflowTaskParams,
    );
    await client.query(
      `DELETE FROM workflow_stage_gates
        WHERE tenant_id = $1
          AND (
            workflow_id = ANY($2::uuid[])
            OR requested_by_task_id = ANY($3::uuid[])
            OR resolved_by_task_id = ANY($3::uuid[])
          )`,
      workflowTaskParams,
    );
    await client.query(
      `DELETE FROM workflow_documents
        WHERE tenant_id = $1
          AND (
            workflow_id = ANY($2::uuid[])
            OR task_id = ANY($3::uuid[])
            OR ($4::uuid IS NOT NULL AND workspace_id = $4::uuid)
          )`,
      workflowTaskWorkspaceParams,
    );
    await client.query(
      `DELETE FROM workflow_artifacts
        WHERE tenant_id = $1
          AND (
            workflow_id = ANY($2::uuid[])
            OR task_id = ANY($3::uuid[])
            OR ($4::uuid IS NOT NULL AND workspace_id = $4::uuid)
          )`,
      workflowTaskWorkspaceParams,
    );
    await client.query('DELETE FROM workflow_tool_results WHERE tenant_id = $1 AND workflow_id = ANY($2::uuid[])', workflowParams);
    await client.query('DELETE FROM orchestrator_grants WHERE tenant_id = $1 AND workflow_id = ANY($2::uuid[])', workflowParams);
    await client.query(
      `DELETE FROM integration_adapter_deliveries
        WHERE tenant_id = $1
          AND adapter_id IN (
            SELECT id
              FROM integration_adapters
             WHERE tenant_id = $1
               AND workflow_id = ANY($2::uuid[])
          )`,
      workflowParams,
    );
    await client.query(
      `DELETE FROM integration_adapters
        WHERE tenant_id = $1
          AND workflow_id = ANY($2::uuid[])`,
      workflowParams,
    );
    await client.query(
      `DELETE FROM webhook_work_item_trigger_invocations
        WHERE tenant_id = $1
          AND trigger_id IN (
            SELECT id
              FROM webhook_work_item_triggers
             WHERE tenant_id = $1
               AND (
                 workflow_id = ANY($2::uuid[])
                 OR ($3::uuid IS NOT NULL AND workspace_id = $3::uuid)
               )
          )`,
      workflowWorkspaceParams,
    );
    await client.query(
      `DELETE FROM webhook_work_item_triggers
        WHERE tenant_id = $1
          AND (
            workflow_id = ANY($2::uuid[])
            OR ($3::uuid IS NOT NULL AND workspace_id = $3::uuid)
          )`,
      workflowWorkspaceParams,
    );
    await client.query(
      `DELETE FROM scheduled_work_item_trigger_invocations
        WHERE tenant_id = $1
          AND trigger_id IN (
            SELECT id
              FROM scheduled_work_item_triggers
             WHERE tenant_id = $1
               AND (
                 workflow_id = ANY($2::uuid[])
                 OR ($3::uuid IS NOT NULL AND workspace_id = $3::uuid)
               )
          )`,
      workflowWorkspaceParams,
    );
    await client.query(
      `DELETE FROM scheduled_work_item_triggers
        WHERE tenant_id = $1
          AND (
            workflow_id = ANY($2::uuid[])
            OR ($3::uuid IS NOT NULL AND workspace_id = $3::uuid)
          )`,
      workflowWorkspaceParams,
    );
    await client.query('DELETE FROM workflow_branches WHERE tenant_id = $1 AND workflow_id = ANY($2::uuid[])', workflowParams);
    await client.query('DELETE FROM workflow_stages WHERE tenant_id = $1 AND workflow_id = ANY($2::uuid[])', workflowParams);
    const deletedTasks = await client.query<{ id: string }>(
      `DELETE FROM tasks
        WHERE tenant_id = $1
          AND id = ANY($2::uuid[])
      RETURNING id`,
      taskParams,
    );
    await client.query('DELETE FROM workflow_work_items WHERE tenant_id = $1 AND workflow_id = ANY($2::uuid[])', workflowParams);
    await client.query('DELETE FROM workflow_activations WHERE tenant_id = $1 AND workflow_id = ANY($2::uuid[])', workflowParams);
    const deletedWorkflows = await client.query<{ id: string }>(
      `DELETE FROM workflows
        WHERE tenant_id = $1
          AND id = ANY($2::uuid[])
      RETURNING id`,
      workflowParams,
    );
    return {
      deleted_task_count: deletedTasks.rowCount ?? 0,
      deleted_workflow_count: deletedWorkflows.rowCount ?? 0,
    };
  }

  private async loadPlaybook(tenantId: string, playbookId: string) {
    const result = await this.pool.query<{ id: string; slug: string }>(
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

  private async assertWorkspaceExists(tenantId: string, workspaceId: string) {
    const result = await this.pool.query<{ id: string }>(
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

  private async listPlaybookFamilyIds(
    db: Pick<DatabasePool, 'query'> | Pick<DatabaseClient, 'query'>,
    tenantId: string,
    slug: string,
  ) {
    const result = await db.query<{ id: string }>(
      `SELECT id
         FROM playbooks
        WHERE tenant_id = $1
          AND slug = $2`,
      [tenantId, slug],
    );
    return result.rows.map((row) => row.id);
  }

  private async listWorkflowIdsForPlaybooks(
    db: Pick<DatabasePool, 'query'> | Pick<DatabaseClient, 'query'>,
    tenantId: string,
    playbookIds: string[],
  ) {
    const result = await db.query<{ id: string }>(
      `SELECT id
         FROM workflows
        WHERE tenant_id = $1
          AND playbook_id = ANY($2::uuid[])`,
      [tenantId, uniqueIds(playbookIds)],
    );
    return result.rows.map((row) => row.id);
  }

  private async listActiveWorkflowIdsForPlaybooks(
    db: Pick<DatabasePool, 'query'> | Pick<DatabaseClient, 'query'>,
    tenantId: string,
    playbookIds: string[],
  ) {
    const result = await db.query<{ id: string }>(
      `SELECT id
         FROM workflows
        WHERE tenant_id = $1
          AND playbook_id = ANY($2::uuid[])
          AND state::text <> ALL($3::text[])`,
      [tenantId, uniqueIds(playbookIds), [...TERMINAL_WORKFLOW_STATES]],
    );
    return result.rows.map((row) => row.id);
  }

  private async listWorkflowIdsForWorkspace(
    db: Pick<DatabasePool, 'query'> | Pick<DatabaseClient, 'query'>,
    tenantId: string,
    workspaceId: string,
  ) {
    const result = await db.query<{ id: string }>(
      `SELECT id
         FROM workflows
        WHERE tenant_id = $1
          AND workspace_id = $2`,
      [tenantId, workspaceId],
    );
    return result.rows.map((row) => row.id);
  }

  private async listActiveWorkflowIdsForWorkspace(
    db: Pick<DatabasePool, 'query'> | Pick<DatabaseClient, 'query'>,
    tenantId: string,
    workspaceId: string,
  ) {
    const result = await db.query<{ id: string }>(
      `SELECT id
         FROM workflows
        WHERE tenant_id = $1
          AND workspace_id = $2
          AND state::text <> ALL($3::text[])`,
      [tenantId, workspaceId, [...TERMINAL_WORKFLOW_STATES]],
    );
    return result.rows.map((row) => row.id);
  }

  private async listTaskIdsForWorkflows(
    db: Pick<DatabasePool, 'query'> | Pick<DatabaseClient, 'query'>,
    tenantId: string,
    workflowIds: string[],
  ) {
    const result = await db.query<{ id: string }>(
      `SELECT id
         FROM tasks
        WHERE tenant_id = $1
          AND workflow_id = ANY($2::uuid[])`,
      [tenantId, uniqueIds(workflowIds)],
    );
    return result.rows.map((row) => row.id);
  }

  private async listTaskIdsForWorkspace(
    db: Pick<DatabasePool, 'query'> | Pick<DatabaseClient, 'query'>,
    tenantId: string,
    workspaceId: string,
  ) {
    const result = await db.query<{ id: string }>(
      `SELECT id
         FROM tasks
        WHERE tenant_id = $1
          AND workspace_id = $2`,
      [tenantId, workspaceId],
    );
    return result.rows.map((row) => row.id);
  }

  private async listActiveStandaloneTaskIdsForWorkspace(
    db: Pick<DatabasePool, 'query'> | Pick<DatabaseClient, 'query'>,
    tenantId: string,
    workspaceId: string,
  ) {
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

  private async cancelWorkflows(identity: ApiKeyIdentity, workflowIds: string[]) {
    if (!this.deps.cancelWorkflow) {
      return;
    }
    for (const workflowId of uniqueIds(workflowIds)) {
      await this.deps.cancelWorkflow(identity, workflowId);
    }
  }

  private async cancelTasks(identity: ApiKeyIdentity, taskIds: string[]) {
    if (!this.deps.cancelTask) {
      return;
    }
    for (const taskId of uniqueIds(taskIds)) {
      await this.deps.cancelTask(identity, taskId);
    }
  }
}

function uniqueIds(values: string[]) {
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
