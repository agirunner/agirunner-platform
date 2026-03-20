import type { DatabasePool } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';
import {
  parsePlaybookDefinition,
  readPlaybookRuntimePools,
  type PlaybookRuntimePoolKind,
} from '../orchestration/playbook-model.js';

const RUNTIME_CONFIG_SECRET_REDACTION = 'redacted://runtime-config-secret';
const runtimeConfigSecretKeyPattern =
  /(secret|token|password|api[_-]?key|credential|authorization|private[_-]?key|webhook_url|known_hosts)/i;
const REMOVED_RUNTIME_DEFAULT_KEYS = new Set([
  'tools.web_search_provider',
  'tools.web_search_base_url',
  'tools.web_search_api_key_secret_ref',
  'tools.web_search_timeout_seconds',
]);
const GENERIC_SPECIALIST_TARGET_ID = 'specialist';

interface RuntimeConfigRole {
  name: string;
  description: string | null;
  systemPrompt: string | null;
  allowedTools: string[];
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
  routing_tags: string[];
}

interface DesiredStateWorkerRow {
  worker_name: string;
  role: string | null;
}

interface WorkerConfigTarget {
  name: string;
  routingTags: string[];
  roleNames: string[];
  allowAllRolesWhenEmpty: boolean;
}

interface RuntimeTargetLookup {
  playbookId?: string;
  poolKind?: string;
}

interface PlaybookRow {
  definition: unknown;
}

export class RuntimeConfigService {
  constructor(private readonly pool: DatabasePool) {}

  async getConfigForWorker(
    tenantId: string,
    workerName: string,
    runtimeTarget: RuntimeTargetLookup = {},
  ): Promise<RuntimeConfig> {
    const worker = await this.findWorker(tenantId, workerName, runtimeTarget);
    const roleNames = this.resolveRoleNames(worker);

    const [roles, defaults] = await Promise.all([
      this.fetchRoles(tenantId, roleNames, worker.allowAllRolesWhenEmpty),
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

  private async findWorker(
    tenantId: string,
    workerName: string,
    runtimeTarget: RuntimeTargetLookup,
  ): Promise<WorkerConfigTarget> {
    const desiredStateWorker = await this.findDesiredStateWorker(tenantId, workerName);
    if (desiredStateWorker) {
      return desiredStateWorker;
    }

    const registeredWorker = await this.findRegisteredWorker(tenantId, workerName);
    if (registeredWorker) {
      return registeredWorker;
    }

    const playbookRuntimeTarget = await this.findPlaybookRuntimeTarget(tenantId, workerName, runtimeTarget);
    if (playbookRuntimeTarget) {
      return playbookRuntimeTarget;
    }

    const genericSpecialistRuntimeTarget = this.findGenericSpecialistRuntimeTarget(
      workerName,
      runtimeTarget,
    );
    if (genericSpecialistRuntimeTarget) {
      return genericSpecialistRuntimeTarget;
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
        routingTags: [],
        roleNames: row.role ? [row.role] : [],
        allowAllRolesWhenEmpty: false,
      };
  }

  private findRegisteredWorker(
    tenantId: string,
    workerName: string,
  ): Promise<WorkerConfigTarget | null> {
    return this.pool
      .query<WorkerRow>(
        'SELECT name, routing_tags FROM workers WHERE tenant_id = $1 AND name = $2 LIMIT 1',
        [tenantId, workerName],
      )
      .then((result) =>
        result.rowCount
          ? {
              name: result.rows[0].name,
              routingTags: result.rows[0].routing_tags,
              roleNames: [],
              allowAllRolesWhenEmpty: true,
            }
          : null,
      );
  }

  private async findPlaybookRuntimeTarget(
    tenantId: string,
    workerName: string,
    runtimeTarget: RuntimeTargetLookup,
  ): Promise<WorkerConfigTarget | null> {
    const playbookId = runtimeTarget.playbookId?.trim();
    const poolKind = normalizePoolKind(runtimeTarget.poolKind);
    if (!playbookId || !poolKind) {
      return null;
    }

    const result = await this.pool.query<PlaybookRow>(
      `SELECT definition
       FROM playbooks
       WHERE tenant_id = $1
         AND id = $2
         AND is_active = true
       LIMIT 1`,
      [tenantId, playbookId],
    );
    if (!result.rowCount) {
      return null;
    }

    const definition = parsePlaybookDefinition(result.rows[0].definition);
    const pools = readPlaybookRuntimePools(definition);
    const matchingPool = pools.find((pool) => pool.pool_kind === poolKind);
    if (!matchingPool) {
      return null;
    }

    return {
      name: workerName,
      routingTags: [],
      roleNames: resolveRuntimeTargetRoleNames(definition.roles, poolKind),
      allowAllRolesWhenEmpty: false,
    };
  }

  private findGenericSpecialistRuntimeTarget(
    workerName: string,
    runtimeTarget: RuntimeTargetLookup,
  ): WorkerConfigTarget | null {
    const poolKind = normalizePoolKind(runtimeTarget.poolKind);
    const playbookId = runtimeTarget.playbookId?.trim() ?? '';
    if (poolKind !== 'specialist') {
      return null;
    }
    if (playbookId.length > 0 && playbookId !== GENERIC_SPECIALIST_TARGET_ID) {
      return null;
    }
    return {
      name: workerName,
      routingTags: [],
      roleNames: [],
      allowAllRolesWhenEmpty: true,
    };
  }

  private resolveRoleNames(worker: WorkerConfigTarget): string[] {
    if (worker.roleNames.length > 0) {
      return worker.roleNames;
    }
    if (worker.allowAllRolesWhenEmpty) {
      return this.extractRoleNames(worker.routingTags);
    }
    return [];
  }

  private extractRoleNames(routingTags: string[]): string[] {
    return routingTags
      .filter((routingTag) => routingTag.startsWith('role:'))
      .map((routingTag) => routingTag.slice(5));
  }

  private async fetchRoles(
    tenantId: string,
    roleNames: string[],
    allowAllRolesWhenEmpty: boolean,
  ): Promise<RuntimeConfigRole[]> {
    if (roleNames.length === 0) {
      if (!allowAllRolesWhenEmpty) {
        return [];
      }
      const result = await this.pool.query<RoleRow>(
        'SELECT name, description, system_prompt, allowed_tools, verification_strategy, updated_at FROM role_definitions WHERE tenant_id = $1 AND is_active = true',
        [tenantId],
      );
      return result.rows.map(this.mapRole);
    }

    const placeholders = roleNames.map((_, i) => `$${i + 2}`).join(', ');
    const result = await this.pool.query<RoleRow>(
      `SELECT name, description, system_prompt, allowed_tools, verification_strategy, updated_at
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
      verificationStrategy: row.verification_strategy,
    };
  }

  private async fetchDefaults(tenantId: string): Promise<RuntimeConfigDefault[]> {
    const result = await this.pool.query<DefaultRow>(
      'SELECT config_key, config_value, config_type, updated_at FROM runtime_defaults WHERE tenant_id = $1',
      [tenantId],
    );
    return result.rows
      .filter((row) => !REMOVED_RUNTIME_DEFAULT_KEYS.has(row.config_key))
      .map((row) => ({
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

function normalizePoolKind(value: string | undefined): PlaybookRuntimePoolKind | null {
  switch (value?.trim()) {
  case 'orchestrator':
    return 'orchestrator';
  case 'specialist':
    return 'specialist';
  default:
    return null;
  }
}

function resolveRuntimeTargetRoleNames(
  roles: string[],
  poolKind: PlaybookRuntimePoolKind,
): string[] {
  if (poolKind === 'orchestrator') {
    return ['orchestrator'];
  }
  return roles
    .map((role) => role.trim())
    .filter((role) => role.length > 0);
}
