import type pg from 'pg';

import {
  loadBuiltInRolesConfig,
  type BuiltInRolesConfig,
  type RoleName,
} from '../config/role-config.js';
import { RoleDefinitionService } from '../services/role-definition-service.js';
import { RuntimeDefaultsService } from '../services/runtime-defaults-service.js';
import { UserService } from '../services/user-service.js';
import { DEFAULT_TENANT_ID } from '../db/seed.js';
import { seedDefaultTemplates } from './template-seed.js';

/**
 * Seeds configuration tables from the file-based config on first run.
 *
 * This provides backwards compatibility: if the DB config tables are empty,
 * the system loads from the JSON files. Once an admin modifies config via the
 * API, the DB values take precedence.
 *
 * Idempotent — skips seeding if roles already exist for the default tenant.
 */
export async function seedConfigTables(pool: pg.Pool): Promise<void> {
  await seedRolesAndDefaults(pool);
  await seedAdminUser(pool);
  await seedDefaultTemplates(pool);
}

async function seedRolesAndDefaults(pool: pg.Pool): Promise<void> {
  const roleService = new RoleDefinitionService(pool);
  const defaultsService = new RuntimeDefaultsService(pool);

  const existingRoles = await roleService.listRoles(DEFAULT_TENANT_ID);
  if (existingRoles.length > 0) {
    return;
  }

  let rolesConfig: BuiltInRolesConfig;
  try {
    rolesConfig = loadBuiltInRolesConfig();
  } catch {
    console.info('[config-seed] No built-in-roles.json found, skipping config seed.');
    return;
  }

  await seedRoleDefinitions(roleService, rolesConfig);
  await seedRuntimeDefaults(defaultsService, rolesConfig);

  console.info('[config-seed] Configuration tables seeded from built-in-roles.json.');
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
      modelPreference: role.modelPreference,
      verificationStrategy: role.verificationStrategy,
      capabilities: role.capabilities,
      isBuiltIn: true,
      isActive: true,
    });
  }
}

async function seedRuntimeDefaults(
  service: RuntimeDefaultsService,
  config: BuiltInRolesConfig,
): Promise<void> {
  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'default_provider',
    configValue: config.defaultProvider,
    configType: 'string',
    description: 'Default LLM provider name',
  });

  await service.upsertDefault(DEFAULT_TENANT_ID, {
    configKey: 'max_rework_attempts',
    configValue: String(config.maxReworkAttempts),
    configType: 'number',
    description: 'Maximum number of rework attempts before permanently failing a task',
  });
}

async function seedAdminUser(pool: pg.Pool): Promise<void> {
  const userService = new UserService(pool);

  const existing = await userService.listUsers(DEFAULT_TENANT_ID);
  if (existing.length > 0) {
    return;
  }

  const email = process.env.AGIRUNNER_ADMIN_EMAIL ?? 'admin@localhost';

  await userService.createUser(DEFAULT_TENANT_ID, {
    email,
    displayName: 'Admin',
    role: 'org_admin',
  });

  console.info(`[config-seed] Admin user created: ${email} (authenticate via API key)`);
}
