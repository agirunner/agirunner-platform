import type { DatabasePool } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';

interface RuntimeConfigRole {
  name: string;
  description: string | null;
  systemPrompt: string | null;
  allowedTools: string[];
  capabilities: string[];
  verificationStrategy: string | null;
}

interface RuntimeConfigModel {
  modelId: string;
  providerId: string;
  providerName: string;
  providerBaseUrl: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  supportsToolUse: boolean;
  supportsVision: boolean;
}

interface RuntimeConfigDefault {
  key: string;
  value: string;
  type: string;
}

export interface RuntimeConfig {
  workerName: string;
  roles: RuntimeConfigRole[];
  primaryModel: RuntimeConfigModel | null;
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

interface ModelJoinRow {
  model_id: string;
  provider_id: string;
  provider_name: string;
  provider_base_url: string;
  context_window: number | null;
  max_output_tokens: number | null;
  supports_tool_use: boolean;
  supports_vision: boolean;
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

    let primaryModel: RuntimeConfigModel | null = null;

    if (roleCaps.length > 0) {
      const assignment = await this.fetchModelAssignment(tenantId, roleCaps[0]);
      if (assignment) {
        primaryModel = assignment.primary;
      }
    }

    const maxUpdatedAt = this.computeVersion(roles, defaults);

    return {
      workerName: worker.name,
      roles,
      primaryModel,
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
      value: row.config_value,
      type: row.config_type,
    }));
  }

  private async fetchModelAssignment(
    tenantId: string,
    roleName: string,
  ): Promise<{ primary: RuntimeConfigModel | null } | null> {
    const result = await this.pool.query<{
      primary_model_id: string | null;
    }>(
      'SELECT primary_model_id FROM role_model_assignments WHERE tenant_id = $1 AND role_name = $2',
      [tenantId, roleName],
    );
    if (!result.rowCount) return null;

    const row = result.rows[0];
    const primary = row.primary_model_id ? await this.fetchModelWithProvider(row.primary_model_id) : null;

    return { primary };
  }

  private async fetchModelWithProvider(modelId: string): Promise<RuntimeConfigModel | null> {
    const result = await this.pool.query<ModelJoinRow>(
      `SELECT m.model_id, m.provider_id, p.name AS provider_name, p.base_url AS provider_base_url,
              m.context_window, m.max_output_tokens, m.supports_tool_use, m.supports_vision
       FROM llm_models m
       JOIN llm_providers p ON p.id = m.provider_id
       WHERE m.id = $1 AND m.is_enabled = true AND p.is_enabled = true`,
      [modelId],
    );
    if (!result.rowCount) return null;

    const row = result.rows[0];
    return {
      modelId: row.model_id,
      providerId: row.provider_id,
      providerName: row.provider_name,
      providerBaseUrl: row.provider_base_url,
      contextWindow: row.context_window,
      maxOutputTokens: row.max_output_tokens,
      supportsToolUse: row.supports_tool_use,
      supportsVision: row.supports_vision,
    };
  }

  private computeVersion(
    roles: RuntimeConfigRole[],
    defaults: RuntimeConfigDefault[],
  ): Date {
    return new Date();
  }
}
