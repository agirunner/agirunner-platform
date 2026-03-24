import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';

export interface RetentionPolicy {
  task_prune_after_days: number;
  workflow_delete_after_days: number;
  execution_log_retention_days: number;
}

interface GovernanceServiceConfig {
  GOVERNANCE_TASK_PRUNE_AFTER_DAYS: number;
  GOVERNANCE_WORKFLOW_DELETE_AFTER_DAYS: number;
  GOVERNANCE_EXECUTION_LOG_RETENTION_DAYS: number;
}

interface TenantRow {
  id: string;
  settings: Record<string, unknown> | null;
}

const TERMINAL_TASK_STATES = ['completed', 'failed', 'cancelled'] as const;
const TERMINAL_WORKFLOW_STATES = ['completed', 'failed', 'cancelled'] as const;

export class GovernanceService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly config: GovernanceServiceConfig,
  ) {}

  async getRetentionPolicy(tenantId: string): Promise<RetentionPolicy> {
    const tenant = await this.loadTenant(tenantId);
    return readRetentionPolicy(tenant.settings, this.config);
  }

  async updateRetentionPolicy(
    identity: ApiKeyIdentity,
    policy: Partial<RetentionPolicy>,
  ): Promise<RetentionPolicy> {
    const current = await this.getRetentionPolicy(identity.tenantId);
    const next = {
      ...current,
      ...omitUndefined(policy),
    };

    await this.pool.query(
      `UPDATE tenants
       SET settings = jsonb_set(
             COALESCE(settings, '{}'::jsonb),
             '{governance}',
             jsonb_set(
               COALESCE(COALESCE(settings, '{}'::jsonb)->'governance', '{}'::jsonb),
               '{retention}',
               $2::jsonb,
               true
             ),
             true
           ),
           updated_at = now()
       WHERE id = $1`,
      [identity.tenantId, JSON.stringify(next)],
    );

    return next;
  }

  async enforceRetentionPolicies(): Promise<{
    prunedTasks: number;
    deletedWorkflows: number;
    droppedLogPartitions: number;
  }> {
    const tenants = await this.pool.query<TenantRow>(
      'SELECT id, settings FROM tenants WHERE is_active = true',
    );
    let prunedTasks = 0;
    let deletedWorkflows = 0;
    let droppedLogPartitions = 0;

    for (const tenant of tenants.rows) {
      const policy = readRetentionPolicy(tenant.settings, this.config);
      prunedTasks += await this.pruneTerminalTasksFromOngoingWorkflows(tenant.id, policy);
      deletedWorkflows += await this.deleteExpiredTerminalWorkflowTrees(tenant.id, policy);
    }

    // Execution log partition drop is global (partitions are not per-tenant).
    // Use the shortest retention across all tenants, floored at 30 days.
    const minRetention = tenants.rows.reduce((min, t) => {
      const p = readRetentionPolicy(t.settings, this.config);
      return Math.min(min, p.execution_log_retention_days);
    }, this.config.GOVERNANCE_EXECUTION_LOG_RETENTION_DAYS);
    droppedLogPartitions = await this.dropOldLogPartitions(Math.max(minRetention, 30));

    // Ensure future log partitions exist (current + next 2 months).
    await this.ensureLogPartitions();

    return { prunedTasks, deletedWorkflows, droppedLogPartitions };
  }

  async getLoggingLevel(tenantId: string): Promise<string> {
    const tenant = await this.loadTenant(tenantId);
    const logging = asRecord(tenant.settings?.logging);
    const level = logging.level;
    if (typeof level === 'string' && ['debug', 'info', 'warn', 'error'].includes(level)) {
      return level;
    }
    return 'debug';
  }

  async setLoggingLevel(identity: ApiKeyIdentity, level: string): Promise<string> {
    await this.pool.query(
      `UPDATE tenants
       SET settings = jsonb_set(
         COALESCE(settings, '{}'::jsonb),
         '{logging}',
         jsonb_set(
           COALESCE(COALESCE(settings, '{}'::jsonb)->'logging', '{}'::jsonb),
           '{level}',
           $2::jsonb,
           true
         ),
         true
       ),
       updated_at = now()
       WHERE id = $1`,
      [identity.tenantId, JSON.stringify(level)],
    );

    return level;
  }

  private async loadTenant(tenantId: string): Promise<TenantRow> {
    const result = await this.pool.query<TenantRow>(
      'SELECT id, settings FROM tenants WHERE id = $1',
      [tenantId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Tenant not found');
    }
    return result.rows[0];
  }

  private async pruneTerminalTasksFromOngoingWorkflows(
    tenantId: string,
    policy: RetentionPolicy,
  ): Promise<number> {
    const result = await this.pool.query<{ id: string }>(
      `DELETE FROM tasks t
       USING workflows w
       WHERE t.tenant_id = $1
         AND t.workflow_id = w.id
         AND w.tenant_id = $1
         AND COALESCE(t.legal_hold, false) = false
         AND COALESCE(w.legal_hold, false) = false
         AND t.state::text = ANY($2::text[])
         AND w.state::text <> ALL($3::text[])
         AND t.completed_at IS NOT NULL
         AND t.completed_at <= now() - make_interval(days => $4::int)
       RETURNING t.id`,
      [
        tenantId,
        [...TERMINAL_TASK_STATES],
        [...TERMINAL_WORKFLOW_STATES],
        policy.task_prune_after_days,
      ],
    );

    return result.rowCount ?? 0;
  }

  private async deleteExpiredTerminalWorkflowTrees(
    tenantId: string,
    policy: RetentionPolicy,
  ): Promise<number> {
    const deleted = await this.pool.query<{ id: string }>(
      `WITH deletable_workflows AS (
         SELECT id
         FROM workflows
         WHERE tenant_id = $1
           AND COALESCE(legal_hold, false) = false
           AND state::text = ANY($2::text[])
           AND completed_at IS NOT NULL
           AND completed_at <= now() - make_interval(days => $3::int)
       ),
       deleted_documents AS (
         DELETE FROM workflow_documents
         WHERE tenant_id = $1
           AND workflow_id IN (SELECT id FROM deletable_workflows)
       ),
       deleted_task_handoffs AS (
         DELETE FROM task_handoffs
         WHERE tenant_id = $1
           AND workflow_id IN (SELECT id FROM deletable_workflows)
       ),
       deleted_task_messages AS (
         DELETE FROM orchestrator_task_messages
         WHERE tenant_id = $1
           AND workflow_id IN (SELECT id FROM deletable_workflows)
       ),
       deleted_subject_escalations AS (
         DELETE FROM workflow_subject_escalations
         WHERE tenant_id = $1
           AND workflow_id IN (SELECT id FROM deletable_workflows)
       ),
       deleted_tool_results AS (
         DELETE FROM workflow_tool_results
         WHERE tenant_id = $1
           AND workflow_id IN (SELECT id FROM deletable_workflows)
       ),
       deleted_artifacts AS (
         DELETE FROM workflow_artifacts
         WHERE tenant_id = $1
           AND workflow_id IN (SELECT id FROM deletable_workflows)
       ),
       deleted_grants AS (
         DELETE FROM orchestrator_grants
         WHERE tenant_id = $1
           AND workflow_id IN (SELECT id FROM deletable_workflows)
       ),
       deleted_stage_gates AS (
         DELETE FROM workflow_stage_gates
         WHERE tenant_id = $1
           AND workflow_id IN (SELECT id FROM deletable_workflows)
       ),
       deleted_stages AS (
         DELETE FROM workflow_stages
         WHERE tenant_id = $1
           AND workflow_id IN (SELECT id FROM deletable_workflows)
       ),
       deleted_tasks AS (
         DELETE FROM tasks
         WHERE tenant_id = $1
           AND workflow_id IN (SELECT id FROM deletable_workflows)
       ),
       deleted_work_items AS (
         DELETE FROM workflow_work_items
         WHERE tenant_id = $1
           AND workflow_id IN (SELECT id FROM deletable_workflows)
       ),
       deleted_activations AS (
         DELETE FROM workflow_activations
         WHERE tenant_id = $1
           AND workflow_id IN (SELECT id FROM deletable_workflows)
       ),
       deleted_branches AS (
         DELETE FROM workflow_branches
         WHERE tenant_id = $1
           AND workflow_id IN (SELECT id FROM deletable_workflows)
       )
       DELETE FROM workflows w
       WHERE w.tenant_id = $1
         AND w.id IN (SELECT id FROM deletable_workflows)
       RETURNING w.id`,
      [tenantId, [...TERMINAL_WORKFLOW_STATES], policy.workflow_delete_after_days],
    );

    return deleted.rowCount ?? 0;
  }

  private async ensureLogPartitions(): Promise<void> {
    try {
      // Create daily partitions for today and the next 3 days to stay ahead.
      await this.pool.query(`
        SELECT create_execution_logs_partition(current_date);
        SELECT create_execution_logs_partition(current_date + 1);
        SELECT create_execution_logs_partition(current_date + 2);
        SELECT create_execution_logs_partition(current_date + 3);
      `);
    } catch {
      // Function may not exist in older schema versions, or partition already exists
    }
  }

  private async dropOldLogPartitions(retentionDays: number): Promise<number> {
    try {
      const result = await this.pool.query<{ dropped: number }>(
        `SELECT drop_old_execution_log_partitions($1) AS dropped`,
        [retentionDays],
      );
      return result.rows[0]?.dropped ?? 0;
    } catch {
      // Function may not exist in older schema versions
      return 0;
    }
  }
}

function readRetentionPolicy(
  settings: Record<string, unknown> | null,
  config: GovernanceServiceConfig,
): RetentionPolicy {
  const governance = asRecord(settings?.governance);
  const retention = asRecord(governance.retention);

  return {
    task_prune_after_days: readPositiveInt(
      retention.task_prune_after_days,
      config.GOVERNANCE_TASK_PRUNE_AFTER_DAYS,
    ),
    workflow_delete_after_days: readPositiveInt(
      retention.workflow_delete_after_days,
      config.GOVERNANCE_WORKFLOW_DELETE_AFTER_DAYS,
    ),
    execution_log_retention_days: readPositiveInt(
      retention.execution_log_retention_days,
      config.GOVERNANCE_EXECUTION_LOG_RETENTION_DAYS,
    ),
  };
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readPositiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}
