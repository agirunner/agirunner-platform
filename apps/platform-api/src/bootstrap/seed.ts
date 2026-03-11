/**
 * Configuration seeding — idempotent first-run setup.
 *
 * Seeds role definitions, runtime defaults, built-in templates, and the admin user.
 * Skips seeding if roles already exist for the default tenant.
 */
import type pg from 'pg';

import {
  loadBuiltInRolesConfig,
  type BuiltInRolesConfig,
  type RoleName,
} from '../catalogs/built-in-roles.js';
import { BUILT_IN_TEMPLATES } from '../catalogs/built-in-templates.js';
import { RoleDefinitionService } from '../services/role-definition-service.js';
import { RuntimeDefaultsService } from '../services/runtime-defaults-service.js';
import { UserService } from '../services/user-service.js';
import { DEFAULT_TENANT_ID } from '../db/seed.js';

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function seedConfigTables(pool: pg.Pool): Promise<void> {
  await seedRolesAndDefaults(pool);
  await seedAdminUser(pool);
  await seedBuiltInTemplates(pool);
}

// ---------------------------------------------------------------------------
// Roles + runtime defaults
// ---------------------------------------------------------------------------

async function seedRolesAndDefaults(pool: pg.Pool): Promise<void> {
  const roleService = new RoleDefinitionService(pool);
  const defaultsService = new RuntimeDefaultsService(pool);

  const existingRoles = await roleService.listRoles(DEFAULT_TENANT_ID);
  const rolesConfig = loadBuiltInRolesConfig();

  if (existingRoles.length === 0) {
    await seedRoleDefinitions(roleService, rolesConfig);
    await seedRuntimeDefaults(defaultsService);
    console.info('[seed] Role definitions and runtime defaults seeded.');
  } else {
    await seedMissingRoles(roleService, rolesConfig, existingRoles);
  }
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
      isBuiltIn: true,
      isActive: true,
    });
    console.info(`[seed] Added missing role: ${name}`);
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
    description: 'Default Docker image for runtime containers when template does not specify',
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
}

// ---------------------------------------------------------------------------
// Admin user
// ---------------------------------------------------------------------------

async function seedAdminUser(pool: pg.Pool): Promise<void> {
  const userService = new UserService(pool);

  const existing = await userService.listUsers(DEFAULT_TENANT_ID);
  if (existing.length > 0) {
    return;
  }

  const email = process.env.AGIRUNNER_ADMIN_EMAIL ?? 'admin@agirunner.local';

  await userService.createUser(DEFAULT_TENANT_ID, {
    email,
    displayName: 'Admin',
    role: 'org_admin',
  });

  console.info(`[seed] Admin user created: ${email}`);
}

// ---------------------------------------------------------------------------
// Built-in templates
// ---------------------------------------------------------------------------

async function seedBuiltInTemplates(pool: pg.Pool): Promise<void> {
  for (const template of BUILT_IN_TEMPLATES) {
    const existing = await pool.query(
      'SELECT id FROM templates WHERE tenant_id = $1 AND slug = $2 LIMIT 1',
      [DEFAULT_TENANT_ID, template.slug],
    );

    if (existing.rowCount && existing.rowCount > 0) {
      continue;
    }

    await pool.query(
      `INSERT INTO templates (tenant_id, name, slug, description, version, is_built_in, is_published, schema)
       VALUES ($1, $2, $3, $4, 1, true, true, $5)`,
      [DEFAULT_TENANT_ID, template.name, template.slug, template.description, JSON.stringify(template.schema)],
    );

    console.info(`[seed] Built-in template seeded: ${template.slug}`);
  }
}
