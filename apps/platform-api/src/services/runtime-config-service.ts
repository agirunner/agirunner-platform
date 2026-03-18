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
  id: string;
  name: string;
  capabilities: string[];
}

export class RuntimeConfigService {
  constructor(private readonly pool: DatabasePool) {}

  async getConfigForWorker(tenantId: string, workerName: string): Promise<RuntimeConfig> {
    const worker = await this.findWorker(tenantId, workerName);

    const roleCaps = this.extractRoleCapabilities(worker.capabilities);

    const [roles, defaults] = await Promise.all([
      this.fetchRoles(tenantId, roleCaps),
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

  private async findWorker(tenantId: string, workerName: string): Promise<WorkerRow> {
    const result = await this.pool.query<WorkerRow>(
      'SELECT id, name, capabilities FROM workers WHERE tenant_id = $1 AND name = $2 LIMIT 1',
      [tenantId, workerName],
    );
    if (!result.rowCount) throw new NotFoundError(`Worker "${workerName}" not found`);
    return result.rows[0];
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
