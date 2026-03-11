import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';

export interface RetentionPolicy {
  task_archive_after_days: number;
  task_delete_after_days: number;
  execution_log_retention_days: number;
}

interface GovernanceServiceConfig {
  GOVERNANCE_TASK_ARCHIVE_AFTER_DAYS: number;
  GOVERNANCE_TASK_DELETE_AFTER_DAYS: number;
  GOVERNANCE_EXECUTION_LOG_RETENTION_DAYS: number;
}

interface TenantRow {
  id: string;
  settings: Record<string, unknown> | null;
}

export class GovernanceService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly config: GovernanceServiceConfig,
  ) {}

  async getRetentionPolicy(tenantId: string): Promise<RetentionPolicy> {
    const tenant = await this.loadTenant(tenantId);
    return readRetentionPolicy(tenant.settings, this.config);
  }

  async updateRetentionPolicy(identity: ApiKeyIdentity, policy: Partial<RetentionPolicy>): Promise<RetentionPolicy> {
    const current = await this.getRetentionPolicy(identity.tenantId);
    const next = {
      ...current,
      ...omitUndefined(policy),
    };

    await this.pool.query(
      `UPDATE tenants
       SET settings = jsonb_set(settings, '{governance,retention}', $2::jsonb, true),
           updated_at = now()
       WHERE id = $1`,
      [identity.tenantId, JSON.stringify(next)],
    );

    return next;
  }

  async enforceRetentionPolicies(): Promise<{ archivedTasks: number; deletedTasks: number; droppedLogPartitions: number }> {
    const tenants = await this.pool.query<TenantRow>('SELECT id, settings FROM tenants WHERE is_active = true');
    let archivedTasks = 0;
    let deletedTasks = 0;
    let droppedLogPartitions = 0;

    for (const tenant of tenants.rows) {
      const policy = readRetentionPolicy(tenant.settings, this.config);
      archivedTasks += await this.archiveTasks(tenant.id, policy);
      deletedTasks += await this.deleteTasks(tenant.id, policy);
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

    return { archivedTasks, deletedTasks, droppedLogPartitions };
  }

  async getLoggingLevel(tenantId: string): Promise<string> {
    const tenant = await this.loadTenant(tenantId);
    const logging = asRecord(tenant.settings?.logging);
    const level = logging.level;
    if (typeof level === 'string' && ['debug', 'info', 'warn', 'error'].includes(level)) {
      return level;
    }
    return 'info';
  }

  async setLoggingLevel(identity: ApiKeyIdentity, level: string): Promise<string> {
    await this.pool.query(
      `UPDATE tenants
       SET settings = jsonb_set(
         COALESCE(settings, '{}'::jsonb),
         '{logging,level}',
         $2::jsonb,
         true
       ),
       updated_at = now()
       WHERE id = $1`,
      [identity.tenantId, JSON.stringify(level)],
    );

    return level;
  }

  private async loadTenant(tenantId: string): Promise<TenantRow> {
    const result = await this.pool.query<TenantRow>('SELECT id, settings FROM tenants WHERE id = $1', [tenantId]);
    if (!result.rowCount) {
      throw new NotFoundError('Tenant not found');
    }
    return result.rows[0];
  }

  private async archiveTasks(tenantId: string, policy: RetentionPolicy): Promise<number> {
    const result = await this.pool.query<{ id: string }>(
      `UPDATE tasks
       SET archived_at = now(),
           updated_at = now()
       WHERE tenant_id = $1
         AND archived_at IS NULL
         AND completed_at IS NOT NULL
         AND completed_at <= now() - make_interval(days => $2::int)
       RETURNING id`,
      [tenantId, policy.task_archive_after_days],
    );

    return result.rowCount ?? 0;
  }

  private async deleteTasks(tenantId: string, policy: RetentionPolicy): Promise<number> {
    const deletable = await this.pool.query<{ id: string }>(
      `SELECT t.id
       FROM tasks t
       WHERE t.tenant_id = $1
         AND t.completed_at IS NOT NULL
         AND t.completed_at <= now() - make_interval(days => $2::int)`,
      [tenantId, policy.task_delete_after_days],
    );

    if (!deletable.rowCount) {
      return 0;
    }

    await this.pool.query(
      `DELETE FROM tasks
       WHERE tenant_id = $1
         AND id = ANY($2::uuid[])`,
      [tenantId, deletable.rows.map((row) => row.id)],
    );

    return deletable.rowCount ?? 0;
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
    task_archive_after_days: readPositiveInt(
      retention.task_archive_after_days,
      config.GOVERNANCE_TASK_ARCHIVE_AFTER_DAYS,
    ),
    task_delete_after_days: readPositiveInt(
      retention.task_delete_after_days,
      config.GOVERNANCE_TASK_DELETE_AFTER_DAYS,
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
