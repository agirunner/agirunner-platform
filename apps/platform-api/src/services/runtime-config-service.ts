import type { DatabasePool } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';

const RUNTIME_CONFIG_SECRET_REDACTION = 'redacted://runtime-config-secret';
const runtimeConfigSecretKeyPattern =
  /(secret|token|password|api[_-]?key|credential|authorization|private[_-]?key|webhook_url|known_hosts)/i;

interface RuntimeConfigRole {
  name: string;
  description: string | null;
  systemPrompt: string | null;
  allowedTools: string[];
  capabilities: string[];
  verificationStrategy: string | null;
}

interface RuntimeConfigDefault {
  key: string;
  value: string;
  type: string;
}

export interface RuntimeConfig {
  workerName: string;
  roles: RuntimeConfigRole[];
  defaults: RuntimeConfigDefault[];
  version: string;
}

interface RoleRow {
  name: string;
  description: string | null;
  system_prompt: string | null;
  allowed_tools: string[];
  capabilities: string[];
  verification_strategy: string | null;
  updated_at: Date;
}

interface DefaultRow {
  config_key: string;
  config_value: string;
  config_type: string;
  updated_at: Date;
}

interface WorkerRow {
  name: string;
  capabilities: string[];
}

interface DesiredStateWorkerRow {
  worker_name: string;
  role: string | null;
}

interface WorkerConfigTarget {
  name: string;
  capabilities: string[];
  roleNames: string[];
}

export class RuntimeConfigService {
  constructor(private readonly pool: DatabasePool) {}

  async getConfigForWorker(tenantId: string, workerName: string): Promise<RuntimeConfig> {
    const worker = await this.findWorker(tenantId, workerName);
    const roleNames = this.resolveRoleNames(worker);

    const [roles, defaults] = await Promise.all([
      this.fetchRoles(tenantId, roleNames),
      this.fetchDefaults(tenantId),
    ]);

    const maxUpdatedAt = this.computeVersion(roles, defaults);

    return {
      workerName: worker.name,
      roles,
      defaults,
      version: maxUpdatedAt.toISOString(),
    };
  }

  private async findWorker(tenantId: string, workerName: string): Promise<WorkerConfigTarget> {
    const desiredStateWorker = await this.findDesiredStateWorker(tenantId, workerName);
    if (desiredStateWorker) {
      return desiredStateWorker;
    }

    const registeredWorker = await this.findRegisteredWorker(tenantId, workerName);
    if (registeredWorker) {
      return registeredWorker;
    }

    throw new NotFoundError(`Worker "${workerName}" not found`);
  }

  private async findDesiredStateWorker(
    tenantId: string,
    workerName: string,
  ): Promise<WorkerConfigTarget | null> {
    const result = await this.pool.query<DesiredStateWorkerRow>(
      `SELECT worker_name, role
       FROM worker_desired_state
       WHERE tenant_id = $1 AND worker_name = $2 AND enabled = true
       LIMIT 1`,
      [tenantId, workerName],
    );
    if (!result.rowCount) {
      return null;
    }
    const row = result.rows[0];
    return {
      name: row.worker_name,
      capabilities: [],
      roleNames: row.role ? [row.role] : [],
    };
  }

  private findRegisteredWorker(
    tenantId: string,
    workerName: string,
  ): Promise<WorkerConfigTarget | null> {
    return this.pool
      .query<WorkerRow>(
        'SELECT name, capabilities FROM workers WHERE tenant_id = $1 AND name = $2 LIMIT 1',
        [tenantId, workerName],
      )
      .then((result) =>
        result.rowCount
          ? {
              name: result.rows[0].name,
              capabilities: result.rows[0].capabilities,
              roleNames: [],
            }
          : null,
      );
  }

  private resolveRoleNames(worker: WorkerConfigTarget): string[] {
    if (worker.roleNames.length > 0) {
      return worker.roleNames;
    }
    return this.extractRoleCapabilities(worker.capabilities);
  }

  private extractRoleCapabilities(capabilities: string[]): string[] {
    return capabilities
      .filter((cap) => cap.startsWith('role:'))
      .map((cap) => cap.slice(5));
  }

  private async fetchRoles(tenantId: string, roleNames: string[]): Promise<RuntimeConfigRole[]> {
    if (roleNames.length === 0) {
      const result = await this.pool.query<RoleRow>(
        'SELECT name, description, system_prompt, allowed_tools, capabilities, verification_strategy, updated_at FROM role_definitions WHERE tenant_id = $1 AND is_active = true',
        [tenantId],
      );
      return result.rows.map(this.mapRole);
    }

    const placeholders = roleNames.map((_, i) => `$${i + 2}`).join(', ');
    const result = await this.pool.query<RoleRow>(
      `SELECT name, description, system_prompt, allowed_tools, capabilities, verification_strategy, updated_at
       FROM role_definitions WHERE tenant_id = $1 AND name IN (${placeholders}) AND is_active = true`,
      [tenantId, ...roleNames],
    );
    return result.rows.map(this.mapRole);
  }

  private mapRole(row: RoleRow): RuntimeConfigRole {
    return {
      name: row.name,
      description: row.description,
      systemPrompt: row.system_prompt,
      allowedTools: row.allowed_tools,
      capabilities: row.capabilities,
      verificationStrategy: row.verification_strategy,
    };
  }

  private async fetchDefaults(tenantId: string): Promise<RuntimeConfigDefault[]> {
    const result = await this.pool.query<DefaultRow>(
      'SELECT config_key, config_value, config_type, updated_at FROM runtime_defaults WHERE tenant_id = $1',
      [tenantId],
    );
    return result.rows.map((row) => ({
      key: row.config_key,
      value: shouldRedactRuntimeConfigDefault(row.config_key, row.config_value)
        ? RUNTIME_CONFIG_SECRET_REDACTION
        : row.config_value,
      type: row.config_type,
    }));
  }

  private computeVersion(
    roles: RuntimeConfigRole[],
    defaults: RuntimeConfigDefault[],
  ): Date {
    return new Date();
  }
}

function shouldRedactRuntimeConfigDefault(configKey: string, configValue: string): boolean {
  return runtimeConfigSecretKeyPattern.test(configKey) && configValue.trim().length > 0;
}
