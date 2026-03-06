/**
 * Built-in Worker Role Configuration Loader
 *
 * FR-743 — Provides the 4 core role definitions (developer, reviewer, architect, qa).
 * FR-745 — Supports Anthropic, OpenAI, and Google as LLM providers via env/config (BYOK).
 * FR-747 — Loads curated role configs from a config file — NOT hardcoded.
 * FR-750 — Each role declares only llm-api capabilities; Docker/bare-metal are prohibited.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type RoleName = 'developer' | 'reviewer' | 'architect' | 'qa' | 'project-manager';

export type LlmProvider = 'anthropic' | 'openai' | 'google';

export interface ProviderConfig {
  /** Environment variable name that holds the API key (BYOK). */
  envKey: string;
  /** Default model identifier for this provider. */
  defaultModel: string;
}

export interface RoleDefinition {
  /** Human-readable description of the role. */
  description: string;
  /** System prompt injected into every LLM call for this role. */
  systemPrompt: string;
  /** Tools this role is permitted to invoke. */
  allowedTools: string[];
  /** Preferred model identifier for this role. */
  modelPreference: string;
  /**
   * Strategy used to verify the agent's output before accepting it.
   * Values: 'unit_tests' | 'structured_review' | 'peer_review' | 'test_coverage_check'
   */
  verificationStrategy: string;
  /** Capabilities advertised to the platform when this role registers. */
  capabilities: string[];
}

export interface LlmConstraint {
  description: string;
  allowedOperations: string[];
  prohibitedOperations: string[];
}

export interface BuiltInRolesConfig {
  version: string;
  defaultProvider: LlmProvider;
  /** Maximum rework attempts before a task is permanently failed. FR-749. */
  maxReworkAttempts: number;
  providers: Record<LlmProvider, ProviderConfig>;
  roles: Record<RoleName, RoleDefinition>;
  /** Explicit capability boundary declaration. FR-750. */
  llmOnlyConstraint: LlmConstraint;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the absolute path to the bundled config file.
 * Works in both ESM (import.meta.url) and CommonJS (createRequire) contexts.
 */
function resolveConfigPath(): string {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  // src/built-in → src → apps/platform-api → configs/built-in-roles.json
  return path.resolve(dirname, '..', '..', 'configs', 'built-in-roles.json');
}

/**
 * Loads the built-in roles config from the JSON file on disk.
 *
 * Throws if the file is missing or malformed — the built-in worker cannot
 * start without a valid role configuration.
 */
export function loadBuiltInRolesConfig(configPath?: string): BuiltInRolesConfig {
  const resolvedPath = configPath ?? resolveConfigPath();
  const requireFn = createRequire(import.meta.url);
  // Clear require cache so tests can swap the config file.
  delete requireFn.cache[requireFn.resolve(resolvedPath)];
  const raw = requireFn(resolvedPath) as unknown;

  if (!isBuiltInRolesConfig(raw)) {
    throw new Error(`Invalid built-in-roles config at ${resolvedPath}: missing required fields`);
  }

  return raw;
}

/**
 * Returns all role names defined in the config.
 * FR-743: the built-in worker supports the core delivery roles plus project-manager.
 */
export function listRoleNames(config: BuiltInRolesConfig): RoleName[] {
  return Object.keys(config.roles) as RoleName[];
}

/**
 * Returns the capabilities that should be registered for a given role.
 * FR-750: capabilities are explicitly limited to llm-api work.
 */
export function getRoleCapabilities(config: BuiltInRolesConfig, role: RoleName): string[] {
  return config.roles[role].capabilities;
}

/**
 * Returns all capabilities across all roles (de-duplicated).
 * Used when the worker registers as a single multi-role worker.
 */
export function getAllCapabilities(config: BuiltInRolesConfig): string[] {
  const seen = new Set<string>();
  for (const role of Object.values(config.roles)) {
    for (const cap of role.capabilities) {
      seen.add(cap);
    }
  }
  return [...seen];
}

/**
 * Resolves which LLM provider to use.
 *
 * FR-745: Provider selection is environment-driven (BYOK).
 * Priority: BUILT_IN_WORKER_LLM_PROVIDER env var → config default.
 */
export function resolveProvider(
  config: BuiltInRolesConfig,
  env: NodeJS.ProcessEnv = process.env,
): LlmProvider {
  const envProvider = env['BUILT_IN_WORKER_LLM_PROVIDER'];
  if (envProvider && isValidProvider(envProvider, config)) {
    return envProvider as LlmProvider;
  }
  return config.defaultProvider;
}

/**
 * Returns the API key for the resolved provider from the environment.
 * FR-745: API key is always sourced from env (BYOK — never hardcoded).
 */
export function resolveProviderApiKey(
  config: BuiltInRolesConfig,
  provider: LlmProvider,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const envKey = config.providers[provider].envKey;
  return env[envKey];
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isValidProvider(value: string, config: BuiltInRolesConfig): boolean {
  return value in config.providers;
}

function isBuiltInRolesConfig(value: unknown): value is BuiltInRolesConfig {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['version'] === 'string' &&
    typeof obj['defaultProvider'] === 'string' &&
    typeof obj['maxReworkAttempts'] === 'number' &&
    typeof obj['providers'] === 'object' &&
    typeof obj['roles'] === 'object' &&
    typeof obj['llmOnlyConstraint'] === 'object'
  );
}
