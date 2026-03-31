import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import { ConflictError } from '../../errors/domain-errors.js';
import {
  deleteWorkflowArtifacts,
  deleteWorkspaceArtifactFiles,
  deleteWorkspaceScopedTasks,
} from './destructive-delete-artifacts.js';
import {
  assertWorkspaceExists,
  listActiveStandaloneTaskIdsForWorkspace,
  listActiveWorkflowIdsForSelection,
  listActiveWorkflowIdsForPlaybooks,
  listActiveWorkflowIdsForWorkspace,
  listPlaybookFamilyIds,
  listTaskIdsForWorkflows,
  listTaskIdsForWorkspace,
  listWorkflowIdsForSelection,
  listWorkflowIdsForPlaybooks,
  listWorkflowIdsForWorkspace,
  loadPlaybook,
  summarizePlaybookScope,
  summarizeWorkspaceScope,
  uniqueIds,
} from './destructive-delete-queries.js';
import {
  type DeleteImpactSummary,
  type DestructiveDeleteDeps,
  type PlaybookDeleteImpact,
} from './destructive-delete-types.js';

export type { DeleteImpactSummary, PlaybookDeleteImpact };

export class DestructiveDeleteService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly deps: DestructiveDeleteDeps = {},
  ) {}

  async getPlaybookDeleteImpact(tenantId: string, playbookId: string): Promise<PlaybookDeleteImpact> {
    const playbook = await loadPlaybook(this.pool, tenantId, playbookId);
    const familyIds = await listPlaybookFamilyIds(this.pool, tenantId, playbook.slug);

    return {
      revision: await summarizePlaybookScope(this.pool, tenantId, [playbookId]),
      family: {
        revisions: familyIds.length,
        ...(await summarizePlaybookScope(this.pool, tenantId, familyIds)),
      },
    };
  }

  async getWorkspaceDeleteImpact(tenantId: string, workspaceId: string): Promise<DeleteImpactSummary> {
    await assertWorkspaceExists(this.pool, tenantId, workspaceId);
    return summarizeWorkspaceScope(this.pool, tenantId, workspaceId);
  }

  async deletePlaybookPermanently(identity: ApiKeyIdentity, playbookId: string) {
    const playbook = await loadPlaybook(this.pool, identity.tenantId, playbookId);
    const familyIds = await listPlaybookFamilyIds(this.pool, identity.tenantId, playbook.slug);
    const activeWorkflowIds = await listActiveWorkflowIdsForPlaybooks(
      this.pool,
      identity.tenantId,
      familyIds,
    );
    await this.cancelWorkflows(identity, activeWorkflowIds);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const workflowIds = await listWorkflowIdsForPlaybooks(client, identity.tenantId, familyIds);
      const taskIds = await listTaskIdsForWorkflows(client, identity.tenantId, workflowIds);
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
    await assertWorkspaceExists(this.pool, identity.tenantId, workspaceId);
    const activeWorkflowIds = await listActiveWorkflowIdsForWorkspace(
      this.pool,
      identity.tenantId,
      workspaceId,
    );
    const activeStandaloneTaskIds = await listActiveStandaloneTaskIdsForWorkspace(
      this.pool,
      identity.tenantId,
      workspaceId,
    );
    await this.cancelWorkflows(identity, activeWorkflowIds);
    await this.cancelTasks(identity, activeStandaloneTaskIds);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const workflowIds = await listWorkflowIdsForWorkspace(client, identity.tenantId, workspaceId);
      const taskIds = await listTaskIdsForWorkspace(client, identity.tenantId, workspaceId);
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
      await deleteWorkspaceArtifactFiles(
        client,
        this.deps.artifactStorage,
        identity.tenantId,
        workspaceId,
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

  async deleteWorkspaceWithoutDependencies(identity: ApiKeyIdentity, workspaceId: string) {
    await assertWorkspaceExists(this.pool, identity.tenantId, workspaceId);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM workspace_spec_versions
          WHERE tenant_id = $1
            AND workspace_id = $2`,
        [identity.tenantId, workspaceId],
      );
      await deleteWorkspaceArtifactFiles(
        client,
        this.deps.artifactStorage,
        identity.tenantId,
        workspaceId,
      );
      await client.query(
        `DELETE FROM workspaces
          WHERE tenant_id = $1
            AND id = $2`,
        [identity.tenantId, workspaceId],
      );
      await client.query('COMMIT');
      return { id: workspaceId, deleted: true as const };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteWorkflowsPermanently(identity: ApiKeyIdentity, workflowIds: string[]) {
    const selectedWorkflowIds = uniqueIds(workflowIds);
    if (selectedWorkflowIds.length === 0) {
      return {
        deleted: true as const,
        deleted_workflow_count: 0,
        deleted_task_count: 0,
        deleted_workflow_ids: [],
      };
    }

    const activeWorkflowIds = await listActiveWorkflowIdsForSelection(
      this.pool,
      identity.tenantId,
      selectedWorkflowIds,
    );
    await this.cancelWorkflows(identity, activeWorkflowIds);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existingWorkflowIds = await listWorkflowIdsForSelection(
        client,
        identity.tenantId,
        selectedWorkflowIds,
      );
      if (existingWorkflowIds.length === 0) {
        await client.query('COMMIT');
        return {
          deleted: true as const,
          deleted_workflow_count: 0,
          deleted_task_count: 0,
          deleted_workflow_ids: [],
        };
      }
      const taskIds = await listTaskIdsForWorkflows(client, identity.tenantId, existingWorkflowIds);
      const purgeCounts = await this.purgeWorkflowTree(
        client,
        identity.tenantId,
        existingWorkflowIds,
        taskIds,
      );
      await client.query('COMMIT');
      return {
        deleted: true as const,
        deleted_workflow_count: purgeCounts.deleted_workflow_count,
        deleted_task_count: purgeCounts.deleted_task_count,
        deleted_workflow_ids: existingWorkflowIds,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
    await deleteWorkflowArtifacts(
      client,
      this.deps.artifactStorage,
      tenantId,
      uniqueWorkflowIds,
      uniqueTaskIds,
      workspaceId ?? null,
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
          AND (
            workflow_id = ANY($2::uuid[])
            OR id = ANY($3::uuid[])
            OR ($4::uuid IS NOT NULL AND workspace_id = $4::uuid)
          )
      RETURNING id`,
      workflowTaskWorkspaceParams,
    );
    const deletedWorkspaceTasks = workspaceId
      ? await deleteWorkspaceScopedTasks(client, tenantId, workspaceId)
      : { rowCount: 0 };
    await client.query('DELETE FROM workflow_work_items WHERE tenant_id = $1 AND workflow_id = ANY($2::uuid[])', workflowParams);
    await client.query('DELETE FROM workflow_activations WHERE tenant_id = $1 AND workflow_id = ANY($2::uuid[])', workflowParams);
    const deletedWorkflows = await client.query<{ id: string }>(
      `DELETE FROM workflows
        WHERE tenant_id = $1
          AND id = ANY($2::uuid[])
      RETURNING id`,
      workflowParams,
    );
    const deletedLateWorkspaceTasks = workspaceId
      ? await deleteWorkspaceScopedTasks(client, tenantId, workspaceId)
      : { rowCount: 0 };
    return {
      deleted_task_count:
        (deletedTasks.rowCount ?? 0)
        + (deletedWorkspaceTasks.rowCount ?? 0)
        + (deletedLateWorkspaceTasks.rowCount ?? 0),
      deleted_workflow_count: deletedWorkflows.rowCount ?? 0,
    };
  }

  private async cancelWorkflows(identity: ApiKeyIdentity, workflowIds: string[]) {
    if (!this.deps.cancelWorkflow) {
      return;
    }
    for (const workflowId of uniqueIds(workflowIds)) {
      try {
        await this.deps.cancelWorkflow(identity, workflowId);
      } catch (error) {
        if (isAlreadyTerminalWorkflowConflict(error)) {
          continue;
        }
        throw error;
      }
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

function isAlreadyTerminalWorkflowConflict(error: unknown): boolean {
  return error instanceof ConflictError
    ? error.message === 'Workflow is already terminal'
    : error instanceof Error && error.message === 'Workflow is already terminal';
}
