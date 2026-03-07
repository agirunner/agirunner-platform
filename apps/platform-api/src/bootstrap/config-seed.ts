import { randomBytes } from 'node:crypto';

import type pg from 'pg';

import {
  loadBuiltInRolesConfig,
  type BuiltInRolesConfig,
  type LlmProvider,
  type RoleName,
} from '../built-in/role-config.js';
import { ModelCatalogService } from '../services/model-catalog-service.js';
import { RoleDefinitionService } from '../services/role-definition-service.js';
import { RuntimeDefaultsService } from '../services/runtime-defaults-service.js';
import { UserService } from '../services/user-service.js';
import { DEFAULT_TENANT_ID } from '../db/seed.js';

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
  const roleService = new RoleDefinitionService(pool);
  const defaultsService = new RuntimeDefaultsService(pool);
  const catalogService = new ModelCatalogService(pool);

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
  const providerIdMap = await seedLlmProviders(catalogService, rolesConfig);
  const modelIdMap = await seedLlmModels(catalogService, rolesConfig, providerIdMap);
  await seedRoleModelAssignments(catalogService, rolesConfig, modelIdMap);

  console.info('[config-seed] Configuration tables seeded from built-in-roles.json.');

  await seedAdminUser(pool);
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

const PROVIDER_BASE_URLS: Record<LlmProvider, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  google: 'https://generativelanguage.googleapis.com',
};

interface ModelDefaults {
  contextWindow: number;
  maxOutputTokens: number;
  supportsToolUse: boolean;
  supportsVision: boolean;
  inputCostPerMillionUsd: number;
  outputCostPerMillionUsd: number;
}

const MODEL_DEFAULTS: Record<string, ModelDefaults> = {
  'claude-sonnet-4-6': {
    contextWindow: 200_000,
    maxOutputTokens: 16_384,
    supportsToolUse: true,
    supportsVision: true,
    inputCostPerMillionUsd: 3,
    outputCostPerMillionUsd: 15,
  },
  'claude-opus-4-6': {
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    supportsToolUse: true,
    supportsVision: true,
    inputCostPerMillionUsd: 15,
    outputCostPerMillionUsd: 75,
  },
  'claude-haiku-4-5': {
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsToolUse: true,
    supportsVision: true,
    inputCostPerMillionUsd: 0.8,
    outputCostPerMillionUsd: 4,
  },
  'gpt-5-mini': {
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsToolUse: true,
    supportsVision: true,
    inputCostPerMillionUsd: 1.5,
    outputCostPerMillionUsd: 6,
  },
  'gemini-2.5-flash': {
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    supportsToolUse: true,
    supportsVision: true,
    inputCostPerMillionUsd: 0.15,
    outputCostPerMillionUsd: 0.6,
  },
};

const FALLBACK_MODEL_DEFAULTS: ModelDefaults = {
  contextWindow: 128_000,
  maxOutputTokens: 8_192,
  supportsToolUse: true,
  supportsVision: false,
  inputCostPerMillionUsd: 1,
  outputCostPerMillionUsd: 5,
};

async function seedLlmProviders(
  service: ModelCatalogService,
  config: BuiltInRolesConfig,
): Promise<Map<LlmProvider, string>> {
  const existing = await service.listProviders(DEFAULT_TENANT_ID);
  if (existing.length > 0) {
    const map = new Map<LlmProvider, string>();
    for (const row of existing) {
      map.set(row.name as LlmProvider, row.id);
    }
    return map;
  }

  const providerNames = Object.keys(config.providers) as LlmProvider[];
  const providerIdMap = new Map<LlmProvider, string>();

  for (const name of providerNames) {
    const providerConfig = config.providers[name];
    const row = await service.createProvider(DEFAULT_TENANT_ID, {
      name,
      baseUrl: PROVIDER_BASE_URLS[name],
      apiKeySecretRef: providerConfig.envKey,
      isEnabled: true,
      metadata: {},
    });
    providerIdMap.set(name, row.id);
  }

  return providerIdMap;
}

async function seedLlmModels(
  service: ModelCatalogService,
  config: BuiltInRolesConfig,
  providerIdMap: Map<LlmProvider, string>,
): Promise<Map<string, string>> {
  const existing = await service.listModels(DEFAULT_TENANT_ID);
  if (existing.length > 0) {
    const map = new Map<string, string>();
    for (const row of existing) {
      map.set(row.model_id, row.id);
    }
    return map;
  }

  const modelIdMap = new Map<string, string>();
  const seeded = new Set<string>();

  const providerNames = Object.keys(config.providers) as LlmProvider[];
  for (const providerName of providerNames) {
    const modelId = config.providers[providerName].defaultModel;
    if (seeded.has(modelId)) continue;
    seeded.add(modelId);

    const providerId = providerIdMap.get(providerName);
    if (!providerId) continue;

    const defaults = MODEL_DEFAULTS[modelId] ?? FALLBACK_MODEL_DEFAULTS;
    const row = await service.createModel(DEFAULT_TENANT_ID, {
      providerId,
      modelId,
      contextWindow: defaults.contextWindow,
      maxOutputTokens: defaults.maxOutputTokens,
      supportsToolUse: defaults.supportsToolUse,
      supportsVision: defaults.supportsVision,
      inputCostPerMillionUsd: defaults.inputCostPerMillionUsd,
      outputCostPerMillionUsd: defaults.outputCostPerMillionUsd,
      isEnabled: true,
    });
    modelIdMap.set(modelId, row.id);
  }

  /* Seed role-specific models that are not a provider default. */
  const roleNames = Object.keys(config.roles) as RoleName[];
  for (const roleName of roleNames) {
    const modelId = config.roles[roleName].modelPreference;
    if (seeded.has(modelId)) continue;
    seeded.add(modelId);

    const providerId = findProviderForModel(config, providerIdMap, modelId);
    if (!providerId) continue;

    const defaults = MODEL_DEFAULTS[modelId] ?? FALLBACK_MODEL_DEFAULTS;
    const row = await service.createModel(DEFAULT_TENANT_ID, {
      providerId,
      modelId,
      contextWindow: defaults.contextWindow,
      maxOutputTokens: defaults.maxOutputTokens,
      supportsToolUse: defaults.supportsToolUse,
      supportsVision: defaults.supportsVision,
      inputCostPerMillionUsd: defaults.inputCostPerMillionUsd,
      outputCostPerMillionUsd: defaults.outputCostPerMillionUsd,
      isEnabled: true,
    });
    modelIdMap.set(modelId, row.id);
  }

  return modelIdMap;
}

function findProviderForModel(
  config: BuiltInRolesConfig,
  providerIdMap: Map<LlmProvider, string>,
  modelId: string,
): string | undefined {
  const providerNames = Object.keys(config.providers) as LlmProvider[];
  for (const name of providerNames) {
    if (config.providers[name].defaultModel === modelId) {
      return providerIdMap.get(name);
    }
  }

  if (modelId.startsWith('claude')) return providerIdMap.get('anthropic');
  if (modelId.startsWith('gpt')) return providerIdMap.get('openai');
  if (modelId.startsWith('gemini')) return providerIdMap.get('google');

  return undefined;
}

async function seedRoleModelAssignments(
  service: ModelCatalogService,
  config: BuiltInRolesConfig,
  modelIdMap: Map<string, string>,
): Promise<void> {
  const existing = await service.listAssignments(DEFAULT_TENANT_ID);
  if (existing.length > 0) return;

  const roleNames = Object.keys(config.roles) as RoleName[];
  for (const roleName of roleNames) {
    const preferredModelId = config.roles[roleName].modelPreference;
    const primaryModelId = modelIdMap.get(preferredModelId) ?? null;
    await service.upsertAssignment(DEFAULT_TENANT_ID, roleName, primaryModelId, null);
  }
}

async function seedAdminUser(pool: pg.Pool): Promise<void> {
  const userService = new UserService(pool);

  const existing = await userService.listUsers(DEFAULT_TENANT_ID);
  if (existing.length > 0) {
    return;
  }

  const email = process.env.AGIRUNNER_ADMIN_EMAIL ?? 'admin@localhost';
  const password = process.env.AGIRUNNER_ADMIN_PASSWORD ?? randomBytes(16).toString('base64url');
  const isGenerated = !process.env.AGIRUNNER_ADMIN_PASSWORD;

  await userService.createUser(DEFAULT_TENANT_ID, {
    email,
    password,
    displayName: 'Admin',
    role: 'org_admin',
  });

  if (isGenerated) {
    console.info(`[config-seed] Initial admin user created: ${email}`);
    console.info(`[config-seed] Initial admin password: ${password}`);
    console.info('[config-seed] Change this password immediately after first login.');
  } else {
    console.info(`[config-seed] Admin user created: ${email}`);
  }
}
