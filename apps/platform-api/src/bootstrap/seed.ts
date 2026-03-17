/**
 * Configuration seeding — idempotent first-run setup.
 *
 * Seeds role definitions, runtime defaults, built-in playbooks, and the admin user.
 * Skips seeding if roles already exist for the default tenant.
 */
import type pg from 'pg';

import type { AppEnv } from '../config/schema.js';
import type { DatabaseQueryable } from '../db/database.js';
import {
  BUILT_IN_PLAYBOOKS,
} from '../catalogs/built-in-playbooks.js';
import {
  loadBuiltInRolesConfig,
  type BuiltInRolesConfig,
  type RoleName,
} from '../catalogs/built-in-roles.js';
import { RoleDefinitionService } from '../services/role-definition-service.js';
import { RuntimeDefaultsService } from '../services/runtime-defaults-service.js';
import { UserService } from '../services/user-service.js';
import {
  DEFAULT_ADMIN_KEY_PREFIX,
  DEFAULT_TENANT_ID,
} from '../db/seed.js';

const REDESIGN_RESET_PRESERVED_TABLES = new Set([
  'api_keys',
  'llm_providers',
  'llm_models',
  'role_model_assignments',
  'runtime_defaults',
  'schema_migrations',
  'tenants',
]);
const PRESERVED_LLM_RUNTIME_DEFAULT_KEYS = ['default_model_id', 'default_reasoning_config'] as const;

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function seedConfigTables(
  db: DatabaseQueryable,
  config?: Pick<AppEnv, 'AGIRUNNER_ADMIN_EMAIL'>,
): Promise<void> {
  await seedRolesAndDefaults(db);
  await seedOrchestratorWorker(db);
  await seedAdminUser(db, config?.AGIRUNNER_ADMIN_EMAIL);
  await seedBuiltInPlaybooks(db);
}

export async function resetPlaybookRedesignState(pool: pg.Pool): Promise<void> {
  await pool.query(
    `DELETE FROM api_keys
      WHERE tenant_id = $1
        AND key_prefix <> $2`,
    [DEFAULT_TENANT_ID, DEFAULT_ADMIN_KEY_PREFIX],
  );

  const result = await pool.query<{ tablename: string }>(
    `SELECT tablename
       FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename ASC`,
  );

  const tablesToReset = result.rows
    .map((row: { tablename: string }) => row.tablename)
    .filter((tableName: string) => !REDESIGN_RESET_PRESERVED_TABLES.has(tableName));

  if (tablesToReset.length === 0) {
    await deleteNonLlmRuntimeDefaults(pool);
    return;
  }

  const qualifiedTables = tablesToReset
    .map((tableName: string) => `"public"."${tableName}"`)
    .join(', ');
  await pool.query(`TRUNCATE TABLE ${qualifiedTables} RESTART IDENTITY CASCADE`);
  await deleteNonLlmRuntimeDefaults(pool);
}

// ---------------------------------------------------------------------------
// Roles + runtime defaults
// ---------------------------------------------------------------------------

async function seedRolesAndDefaults(db: DatabaseQueryable): Promise<void> {
  const roleService = new RoleDefinitionService(db);
  const defaultsService = new RuntimeDefaultsService(db);

  const existingRoles = await roleService.listRoles(DEFAULT_TENANT_ID);
  const rolesConfig = loadBuiltInRolesConfig();

  if (existingRoles.length === 0) {
    await seedRoleDefinitions(roleService, rolesConfig);
    await seedRuntimeDefaults(defaultsService);
    console.info('[seed] Role definitions and runtime defaults seeded.');
  } else {
    await seedMissingRoles(roleService, rolesConfig, existingRoles);
    await syncBuiltInRoles(roleService, rolesConfig, existingRoles);
  }

  await seedDefaultPrompts(db);
}

async function seedMissingRoles(
  service: RoleDefinitionService,
  config: BuiltInRolesConfig,
  existingRoles: Array<{ name: string }>,
): Promise<void> {
  const existingNames = new Set(existingRoles.map((r) => r.name));
  const allNames = Object.keys(config.roles) as RoleName[];
  const missing = allNames.filter((name) => !existingNames.has(name));

  for (const name of missing) {
    const role = config.roles[name];
    await service.createRole(DEFAULT_TENANT_ID, {
      name,
      description: role.description,
      systemPrompt: role.systemPrompt,
      allowedTools: role.allowedTools,
      verificationStrategy: role.verificationStrategy,
      capabilities: role.capabilities,
      escalationTarget: role.escalationTarget ?? null,
      maxEscalationDepth: role.maxEscalationDepth ?? 5,
      isBuiltIn: true,
      isActive: true,
    });
    console.info(`[seed] Added missing role: ${name}`);
  }
}

async function syncBuiltInRoles(
  service: RoleDefinitionService,
  config: BuiltInRolesConfig,
  existingRoles: Array<{ name: string }>,
): Promise<void> {
  for (const existing of existingRoles) {
    const roleConfig = config.roles[existing.name as RoleName];
    if (!roleConfig) {
      continue;
    }
    const stored = await service.getRoleByName(DEFAULT_TENANT_ID, existing.name);
    if (!stored?.is_built_in) {
      continue;
    }
    const mergedAllowedTools = [...new Set([...(stored.allowed_tools ?? []), ...roleConfig.allowedTools])];
    const mergedCapabilities = [...new Set([...(stored.capabilities ?? []), ...roleConfig.capabilities])];
    const toolsChanged = mergedAllowedTools.length !== (stored.allowed_tools ?? []).length;
    const capabilitiesChanged = mergedCapabilities.length !== (stored.capabilities ?? []).length;
    const escalationTarget = roleConfig.escalationTarget ?? null;
    const escalationTargetChanged = (stored.escalation_target ?? null) !== escalationTarget;
    const maxEscalationDepth = roleConfig.maxEscalationDepth ?? stored.max_escalation_depth ?? 5;
    const maxEscalationDepthChanged = stored.max_escalation_depth !== maxEscalationDepth;
    if (!toolsChanged && !capabilitiesChanged && !escalationTargetChanged && !maxEscalationDepthChanged) {
      continue;
    }
    await service.updateRole(DEFAULT_TENANT_ID, stored.id, {
      allowedTools: mergedAllowedTools,
      capabilities: mergedCapabilities,
      escalationTarget,
      maxEscalationDepth,
    });
    console.info(`[seed] Synced built-in role defaults: ${existing.name}`);
  }
}

async function seedRoleDefinitions(
  service: RoleDefinitionService,
  config: BuiltInRolesConfig,
): Promise<void> {
  const roleNames = Object.keys(config.roles) as RoleName[];

  for (const name of roleNames) {
    const role = config.roles[name];
    await service.createRole(DEFAULT_TENANT_ID, {
      name,
      description: role.description,
      systemPrompt: role.systemPrompt,
      allowedTools: role.allowedTools,
      verificationStrategy: role.verificationStrategy,
      capabilities: role.capabilities,
      escalationTarget: role.escalationTarget ?? null,
      maxEscalationDepth: role.maxEscalationDepth ?? 5,
      isBuiltIn: true,
      isActive: true,
    });
  }
}

async function seedRuntimeDefaults(
  service: RuntimeDefaultsService,
): Promise<void> {
  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'global_max_runtimes',
    configValue: '10',
    configType: 'number',
    description: 'Hard ceiling on total dynamically managed runtime containers',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'default_runtime_image',
    configValue: 'agirunner-runtime:local',
    configType: 'string',
    description: 'Default Docker image for runtime containers when the playbook does not specify one',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'default_cpu',
    configValue: '1',
    configType: 'string',
    description: 'CPU allocation per container. Use "0" for unlimited.',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'default_memory',
    configValue: '256m',
    configType: 'string',
    description: 'Default memory allocation for runtime containers',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'default_pull_policy',
    configValue: 'if-not-present',
    configType: 'string',
    description: 'Default image pull policy for runtime containers',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'default_grace_period',
    configValue: '30',
    configType: 'number',
    description: 'Default grace period in seconds before forced container shutdown',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'agent.max_iterations',
    configValue: '100',
    configType: 'number',
    description: 'Default maximum agent loop iterations for a single task',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'agent.llm_max_retries',
    configValue: '5',
    configType: 'number',
    description: 'Default maximum retries for failed model calls before the task errors',
  });

}

async function deleteNonLlmRuntimeDefaults(db: DatabaseQueryable): Promise<void> {
  await db.query(
    `DELETE FROM runtime_defaults
      WHERE tenant_id = $1
        AND config_key <> ALL($2::text[])`,
    [DEFAULT_TENANT_ID, [...PRESERVED_LLM_RUNTIME_DEFAULT_KEYS]],
  );
}

// ---------------------------------------------------------------------------
// Default orchestrator worker
// ---------------------------------------------------------------------------

async function seedOrchestratorWorker(db: DatabaseQueryable): Promise<void> {
  const existing = await db.query(
    `SELECT id FROM worker_desired_state WHERE tenant_id = $1 AND pool_kind = 'orchestrator' LIMIT 1`,
    [DEFAULT_TENANT_ID],
  );
  if (existing.rowCount && existing.rowCount > 0) return;

  await db.query(
    `INSERT INTO worker_desired_state (tenant_id, worker_name, role, runtime_image, replicas, enabled, pool_kind)
     VALUES ($1, 'orchestrator-primary', 'orchestrator', 'agirunner-runtime:local', 1, true, 'orchestrator')
     ON CONFLICT DO NOTHING`,
    [DEFAULT_TENANT_ID],
  );
  console.info('[seed] Created default orchestrator worker (orchestrator-primary, 1 replica).');
}

// ---------------------------------------------------------------------------
// Default prompts
// ---------------------------------------------------------------------------

async function seedDefaultPrompts(db: DatabaseQueryable): Promise<void> {
  const { DEFAULT_PLATFORM_INSTRUCTIONS, DEFAULT_ORCHESTRATOR_PROMPT } = await import('../catalogs/default-prompts.js');

  // Platform instructions — only seed if empty
  const existing = await db.query(
    'SELECT content FROM platform_instructions WHERE tenant_id = $1',
    [DEFAULT_TENANT_ID],
  );
  if (!existing.rows[0]?.content?.trim()) {
    await db.query(
      `INSERT INTO platform_instructions (tenant_id, content, format, version)
       VALUES ($1, $2, 'markdown', 1)
       ON CONFLICT (tenant_id) DO UPDATE SET content = $2, version = platform_instructions.version + 1, updated_at = NOW()`,
      [DEFAULT_TENANT_ID, DEFAULT_PLATFORM_INSTRUCTIONS],
    );
    console.info('[seed] Seeded default platform instructions.');
  }

  // Orchestrator config — only seed if empty
  const existingOrch = await db.query(
    'SELECT prompt FROM orchestrator_config WHERE tenant_id = $1',
    [DEFAULT_TENANT_ID],
  );
  if (!existingOrch.rows[0]?.prompt?.trim()) {
    await db.query(
      `INSERT INTO orchestrator_config (tenant_id, prompt, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (tenant_id) DO UPDATE SET prompt = $2, updated_at = NOW()`,
      [DEFAULT_TENANT_ID, DEFAULT_ORCHESTRATOR_PROMPT],
    );
    console.info('[seed] Seeded default orchestrator prompt.');
  }
}

// ---------------------------------------------------------------------------
// Admin user
// ---------------------------------------------------------------------------

async function seedAdminUser(db: DatabaseQueryable, adminEmail = 'admin@agirunner.local'): Promise<void> {
  const userService = new UserService(db);

  const existing = await userService.listUsers(DEFAULT_TENANT_ID);
  if (existing.length > 0) {
    return;
  }

  await userService.createUser(DEFAULT_TENANT_ID, {
    email: adminEmail,
    displayName: 'Admin',
    role: 'org_admin',
  });

  console.info(`[seed] Admin user created: ${adminEmail}`);
}

async function seedBuiltInPlaybooks(db: DatabaseQueryable): Promise<void> {
  for (const playbook of BUILT_IN_PLAYBOOKS) {
    const existing = await db.query(
      'SELECT id FROM playbooks WHERE tenant_id = $1 AND slug = $2 AND version = 1 LIMIT 1',
      [DEFAULT_TENANT_ID, playbook.slug],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      continue;
    }

    await db.query(
      `INSERT INTO playbooks (tenant_id, name, slug, description, outcome, lifecycle, version, definition, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, 1, $7, true)`,
      [
        DEFAULT_TENANT_ID,
        playbook.name,
        playbook.slug,
        playbook.description,
        playbook.outcome,
        playbook.lifecycle,
        playbook.definition,
      ],
    );

    console.info(`[seed] Built-in playbook seeded: ${playbook.slug}`);
  }
}
