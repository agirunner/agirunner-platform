import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import { TenantScopedRepository } from '../../db/tenant-scoped-repository.js';
import { NotFoundError } from '../../errors/domain-errors.js';
import { normalizeRepoUrl } from './workspace-records.js';
import { WorkspaceSecretStore } from './workspace-secret-store.js';
import type {
  WorkspaceListSummary,
  WorkspaceRow,
  WorkspaceWorkflowSummaryRow,
} from './workspace-types.js';

export class WorkspaceRecordStore {
  constructor(
    private readonly pool: DatabasePool,
    private readonly secretStore: WorkspaceSecretStore,
  ) {}

  async loadWorkspaceRecord(tenantId: string, workspaceId: string): Promise<WorkspaceRow> {
    const repo = new TenantScopedRepository(this.pool, tenantId);
    const workspace = await repo.findById<WorkspaceRow>('workspaces', '*', workspaceId);
    if (!workspace) {
      throw new NotFoundError('Workspace not found');
    }
    return this.secretStore.ensureWorkspaceSecretsEncrypted(tenantId, workspace);
  }

  async loadWorkspaceForMemoryMutation(
    tenantId: string,
    workspaceId: string,
    client: DatabaseClient,
  ): Promise<WorkspaceRow> {
    const result = await client.query<Record<string, unknown>>(
      `SELECT *
         FROM workspaces
        WHERE tenant_id = $1
          AND id = $2
        FOR UPDATE`,
      [tenantId, workspaceId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workspace not found');
    }
    return result.rows[0] as WorkspaceRow;
  }

  async loadWorkspaceWorkflowSummaries(
    tenantId: string,
    workspaceIds: string[],
  ): Promise<Map<string, WorkspaceListSummary>> {
    if (workspaceIds.length === 0) {
      return new Map();
    }

    const result = await this.pool.query<WorkspaceWorkflowSummaryRow>(
      `SELECT workspace_id::text AS workspace_id,
              COUNT(*) FILTER (WHERE state = 'active')::int AS active_workflow_count,
              COUNT(*) FILTER (WHERE state = 'completed')::int AS completed_workflow_count,
              COUNT(*) FILTER (WHERE state IN ('failed', 'paused'))::int AS attention_workflow_count,
              COUNT(*)::int AS total_workflow_count,
              MAX(COALESCE(completed_at, started_at, updated_at, created_at))::text AS last_workflow_activity_at
         FROM workflows
        WHERE tenant_id = $1
          AND workspace_id = ANY($2::uuid[])
        GROUP BY workspace_id`,
      [tenantId, workspaceIds],
    );

    return new Map(
      result.rows.map((row) => [
        row.workspace_id,
        {
          active_workflow_count: Number(row.active_workflow_count ?? 0),
          completed_workflow_count: Number(row.completed_workflow_count ?? 0),
          attention_workflow_count: Number(row.attention_workflow_count ?? 0),
          total_workflow_count: Number(row.total_workflow_count ?? 0),
          last_workflow_activity_at:
            typeof row.last_workflow_activity_at === 'string'
              ? row.last_workflow_activity_at
              : null,
        },
      ]),
    );
  }

  async findWorkspaceByRepositoryUrl(
    repositoryUrl: string,
  ): Promise<{ id: string; tenant_id: string } | null> {
    const normalized = normalizeRepoUrl(repositoryUrl);
    const result = await this.pool.query<{ id: string; tenant_id: string }>(
      `SELECT id, tenant_id FROM workspaces
       WHERE LOWER(REPLACE(REPLACE(repository_url, '.git', ''), 'http://', 'https://')) = $1
         AND is_active = true
       LIMIT 1`,
      [normalized],
    );
    return result.rowCount ? result.rows[0] : null;
  }
}
