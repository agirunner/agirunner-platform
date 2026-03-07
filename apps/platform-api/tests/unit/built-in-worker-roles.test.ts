/**
 * Unit tests for built-in worker role FRs.
 *
 * FR-743 — Built-in worker registers 4 core role agents.
 * FR-745 — Supports Anthropic, OpenAI, Google as LLM providers (BYOK).
 * FR-747 — Built-in worker uses curated role configs from a config file.
 * FR-748 — Output schema validation before marking task complete.
 * FR-749 — Built-in worker rework flow with configurable max attempts.
 * FR-750 — Built-in worker capabilities explicitly limited to LLM API.
 * FR-753 — External agent preferred over built-in in dispatch.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  loadBuiltInRolesConfig,
  listRoleNames,
  getRoleCapabilities,
  getAllCapabilities,
  resolveProvider,
  resolveProviderApiKey,
} from '../../src/built-in/role-config.js';
import { validateOutputSchema } from '../../src/built-in/output-validator.js';
import {
  decideRework,
  buildReworkContext,
  extractReworkAttemptCount,
} from '../../src/built-in/rework-controller.js';
import { buildWorkerConfigFromRoles } from '../../src/bootstrap/built-in-worker.js';
import { isBuiltInAgentReplaceable } from '../../src/orchestration/capability-matcher.js';
import { selectWorkerForDispatch } from '../../src/services/worker-dispatch-service.js';

// Resolve path to the actual config file bundled with the platform-api package.
const dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(dirname, '..', '..', 'configs', 'built-in-roles.json');

// ---------------------------------------------------------------------------
// FR-747 — Role config loads from file (not hardcoded)
// ---------------------------------------------------------------------------

describe('FR-747: role config loads from file', () => {
  it('loads the config without error', () => {
    expect(() => loadBuiltInRolesConfig(CONFIG_PATH)).not.toThrow();
  });

  it('config has a version field', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    expect(typeof config.version).toBe('string');
    expect(config.version.length).toBeGreaterThan(0);
  });

  it('throws a descriptive error for an invalid config path', () => {
    expect(() => loadBuiltInRolesConfig('/nonexistent/path/built-in-roles.json')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// FR-743 — Built-in worker registers 4 core role agents
// ---------------------------------------------------------------------------

describe('FR-743: 4 core role agents registered', () => {
  it('config defines all 4 required roles', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    const roles = listRoleNames(config);

    expect(roles).toContain('developer');
    expect(roles).toContain('reviewer');
    expect(roles).toContain('architect');
    expect(roles).toContain('qa');
  });

  it('each role has a description', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    for (const role of listRoleNames(config)) {
      expect(config.roles[role].description.length).toBeGreaterThan(0);
    }
  });

  it('each role has a non-empty system prompt', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    for (const role of listRoleNames(config)) {
      expect(config.roles[role].systemPrompt.length).toBeGreaterThan(0);
    }
  });

  it('each role has at least one allowed tool', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    for (const role of listRoleNames(config)) {
      expect(config.roles[role].allowedTools.length).toBeGreaterThan(0);
    }
  });

  it('each role only advertises runtime tool ids that the Go runtime implements', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    const runtimeToolIds = new Set([
      'file_read',
      'file_list',
      'file_edit',
      'file_write',
      'shell_exec',
      'git_status',
      'git_diff',
      'git_log',
      'git_commit',
      'git_push',
    ]);

    for (const role of listRoleNames(config)) {
      for (const tool of config.roles[role].allowedTools) {
        expect(runtimeToolIds.has(tool)).toBe(true);
      }
    }
  });

  it('each role has a model preference', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    for (const role of listRoleNames(config)) {
      expect(config.roles[role].modelPreference.length).toBeGreaterThan(0);
    }
  });

  it('each role has a distinct model preference (no two roles share the same default model)', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    const preferences = listRoleNames(config).map((role) => config.roles[role].modelPreference);
    const uniquePreferences = new Set(preferences);
    expect(uniquePreferences.size).toBe(preferences.length);
  });

  it('each role has a verification strategy', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    for (const role of listRoleNames(config)) {
      expect(config.roles[role].verificationStrategy.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// FR-745 — Supports Anthropic, OpenAI, Google as LLM providers (BYOK)
// ---------------------------------------------------------------------------

describe('FR-745: multi-provider LLM support (BYOK)', () => {
  it('config declares all 3 supported providers', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    expect('anthropic' in config.providers).toBe(true);
    expect('openai' in config.providers).toBe(true);
    expect('google' in config.providers).toBe(true);
  });

  it('each provider has an envKey for BYOK API key injection', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    for (const provider of Object.values(config.providers)) {
      expect(provider.envKey.length).toBeGreaterThan(0);
    }
  });

  it('each provider has a default model', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    for (const provider of Object.values(config.providers)) {
      expect(provider.defaultModel.length).toBeGreaterThan(0);
    }
  });

  it('resolveProvider returns config default when env var is absent', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    const provider = resolveProvider(config, {});
    expect(provider).toBe(config.defaultProvider);
  });

  it('resolveProvider honours BUILT_IN_WORKER_LLM_PROVIDER env var', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    const provider = resolveProvider(config, { BUILT_IN_WORKER_LLM_PROVIDER: 'openai' });
    expect(provider).toBe('openai');
  });

  it('resolveProvider ignores unknown provider in env and falls back to default', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    const provider = resolveProvider(config, { BUILT_IN_WORKER_LLM_PROVIDER: 'unknown-llm' });
    expect(provider).toBe(config.defaultProvider);
  });

  it('resolveProviderApiKey reads the correct env var for anthropic', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    const key = resolveProviderApiKey(config, 'anthropic', { ANTHROPIC_API_KEY: 'sk-ant-test' });
    expect(key).toBe('sk-ant-test');
  });

  it('resolveProviderApiKey returns undefined when env var is absent (no hardcoded key)', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    const key = resolveProviderApiKey(config, 'openai', {});
    expect(key).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// FR-750 — Built-in worker capabilities limited to LLM API
// ---------------------------------------------------------------------------

describe('FR-750: capabilities limited to LLM API', () => {
  it('config declares llmOnlyConstraint', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    expect(config.llmOnlyConstraint).toBeDefined();
    expect(config.llmOnlyConstraint.prohibitedOperations.length).toBeGreaterThan(0);
  });

  it('llmOnlyConstraint prohibits docker-exec', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    expect(config.llmOnlyConstraint.prohibitedOperations).toContain('docker-exec');
  });

  it('llmOnlyConstraint prohibits bare-metal-exec', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    expect(config.llmOnlyConstraint.prohibitedOperations).toContain('bare-metal-exec');
  });

  it('all role capabilities include llm-api', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    for (const role of listRoleNames(config)) {
      const caps = getRoleCapabilities(config, role);
      expect(caps).toContain('llm-api');
    }
  });

  it('getAllCapabilities includes llm-api', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    const allCaps = getAllCapabilities(config);
    expect(allCaps).toContain('llm-api');
  });

  it('buildWorkerConfigFromRoles sets capabilities from role config', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    const workerConfig = buildWorkerConfigFromRoles(
      {
        apiBaseUrl: 'http://localhost:8080',
        adminApiKey: 'ar_admin_test',
        name: 'test-built-in-worker',
        heartbeatIntervalSeconds: 30,
      },
      config,
      {},
    );
    expect(workerConfig.capabilities).toContain('llm-api');
  });

  it('buildWorkerConfigFromRoles sets maxReworkAttempts from config', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    const workerConfig = buildWorkerConfigFromRoles(
      {
        apiBaseUrl: 'http://localhost:8080',
        adminApiKey: 'ar_admin_test',
        name: 'test-built-in-worker',
        heartbeatIntervalSeconds: 30,
      },
      config,
      {},
    );
    expect(workerConfig.maxReworkAttempts).toBe(config.maxReworkAttempts);
  });
});

// ---------------------------------------------------------------------------
// FR-748 — Output schema validation
// ---------------------------------------------------------------------------

describe('FR-748: output schema validation', () => {
  it('passes when no schema is specified', () => {
    const result = validateOutputSchema({ any: 'value' }, undefined);
    expect(result.valid).toBe(true);
  });

  it('passes a valid object against a simple schema', () => {
    const result = validateOutputSchema(
      { name: 'Alice', age: 30 },
      { type: 'object', required: ['name', 'age'], properties: { name: { type: 'string' }, age: { type: 'number' } } },
    );
    expect(result.valid).toBe(true);
  });

  it('fails when a required field is missing', () => {
    const result = validateOutputSchema(
      { name: 'Alice' },
      { type: 'object', required: ['name', 'score'], properties: { name: { type: 'string' }, score: { type: 'number' } } },
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/score/);
  });

  it('fails when a field has the wrong type', () => {
    const result = validateOutputSchema(
      { count: 'not-a-number' },
      { type: 'object', properties: { count: { type: 'number' } } },
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/number/);
  });

  it('fails when a string is shorter than minLength', () => {
    const result = validateOutputSchema(
      { summary: 'hi' },
      { type: 'object', properties: { summary: { type: 'string', minLength: 10 } } },
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/at least/i);
  });

  it('fails when value is not in enum', () => {
    const result = validateOutputSchema(
      'invalid-status',
      { type: 'string', enum: ['pending', 'done', 'failed'] },
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/pending|done|failed/);
  });

  it('validates nested object properties recursively', () => {
    const result = validateOutputSchema(
      { meta: { version: 'not-a-number' } },
      {
        type: 'object',
        properties: {
          meta: {
            type: 'object',
            properties: { version: { type: 'number' } },
          },
        },
      },
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/meta\.version/);
  });

  it('validates array item types', () => {
    const result = validateOutputSchema(
      { tags: ['valid', 123] },
      {
        type: 'object',
        properties: { tags: { type: 'array', items: { type: 'string' } } },
      },
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/tags\[1\]/);
  });

  it('rejects additional properties when additionalProperties: false', () => {
    const result = validateOutputSchema(
      { name: 'Alice', unexpected: 'field' },
      {
        type: 'object',
        properties: { name: { type: 'string' } },
        additionalProperties: false,
      },
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/unexpected/);
  });

  it('passes a number within range constraints', () => {
    const result = validateOutputSchema(
      { score: 85 },
      { type: 'object', properties: { score: { type: 'number', minimum: 0, maximum: 100 } } },
    );
    expect(result.valid).toBe(true);
  });

  it('fails a number below minimum', () => {
    const result = validateOutputSchema(
      { score: -1 },
      { type: 'object', properties: { score: { type: 'number', minimum: 0 } } },
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/>=/);
  });

  // FR-747 / Issue-47: integer type with range constraints
  it('passes an integer at the lower boundary (minimum: 1)', () => {
    const result = validateOutputSchema(1, { type: 'integer', minimum: 1, maximum: 100 });
    expect(result.valid).toBe(true);
  });

  it('passes an integer at the upper boundary (maximum: 100)', () => {
    const result = validateOutputSchema(100, { type: 'integer', minimum: 1, maximum: 100 });
    expect(result.valid).toBe(true);
  });

  it('passes an integer strictly within the range', () => {
    const result = validateOutputSchema(50, { type: 'integer', minimum: 1, maximum: 100 });
    expect(result.valid).toBe(true);
  });

  it('fails an integer below the minimum (0 < minimum 1)', () => {
    const result = validateOutputSchema(0, { type: 'integer', minimum: 1, maximum: 100 });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/>= 1/);
  });

  it('fails an integer above the maximum (101 > maximum 100)', () => {
    const result = validateOutputSchema(101, { type: 'integer', minimum: 1, maximum: 100 });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/<= 100/);
  });

  it('fails a non-integer float that is within the numeric range', () => {
    const result = validateOutputSchema(50.5, { type: 'integer', minimum: 1, maximum: 100 });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/integer/);
  });
});

// ---------------------------------------------------------------------------
// FR-749 — Built-in worker rework flow
// ---------------------------------------------------------------------------

describe('FR-749: rework flow', () => {
  it('approves rework when no attempts have been made yet', () => {
    const decision = decideRework(0, 3, 'schema mismatch: missing field', {});
    expect(decision.shouldRework).toBe(true);
    expect(decision.nextContext).toBeDefined();
  });

  it('includes feedback in the rework context', () => {
    const decision = decideRework(0, 3, 'field "score" is required', {});
    expect(decision.nextContext?.['rework_history']).toBeDefined();
    const history = decision.nextContext?.['rework_history'] as Array<{ feedback: string }>;
    expect(history[0].feedback).toBe('field "score" is required');
  });

  it('denies rework when attempt limit is reached', () => {
    const decision = decideRework(3, 3, 'still invalid', {});
    expect(decision.shouldRework).toBe(false);
    expect(decision.nextContext).toBeUndefined();
  });

  it('allows one final rework attempt when at max-1', () => {
    const decision = decideRework(2, 3, 'last chance', {});
    expect(decision.shouldRework).toBe(true);
  });

  it('buildReworkContext preserves original context fields', () => {
    const context = decideRework(0, 3, 'feedback', { original_field: 'preserved' });
    expect(context.nextContext?.['original_field']).toBe('preserved');
  });

  it('buildReworkContext increments rework_attempt counter', () => {
    const ctx = buildReworkContext({ rework_attempt: 1 }, 'new feedback', 1);
    expect(ctx['rework_attempt']).toBe(2);
  });

  it('buildReworkContext accumulates history across multiple reworks', () => {
    const ctx1 = buildReworkContext({}, 'first failure', 0);
    const ctx2 = buildReworkContext(ctx1, 'second failure', 1);
    const history = ctx2['rework_history'] as Array<{ feedback: string }>;
    expect(history).toHaveLength(2);
    expect(history[0].feedback).toBe('first failure');
    expect(history[1].feedback).toBe('second failure');
  });

  it('extractReworkAttemptCount returns 0 for a fresh task context', () => {
    expect(extractReworkAttemptCount({})).toBe(0);
  });

  it('extractReworkAttemptCount returns the stored attempt count', () => {
    expect(extractReworkAttemptCount({ rework_attempt: 2 })).toBe(2);
  });

  it('extractReworkAttemptCount returns 0 for invalid values', () => {
    expect(extractReworkAttemptCount({ rework_attempt: 'not-a-number' })).toBe(0);
  });

  it('config-driven maxReworkAttempts is respected (from built-in-roles.json)', () => {
    const config = loadBuiltInRolesConfig(CONFIG_PATH);
    // maxReworkAttempts must be a positive integer from config — not hardcoded.
    expect(config.maxReworkAttempts).toBeGreaterThan(0);
    expect(Number.isInteger(config.maxReworkAttempts)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FR-753 — External agent preferred over built-in
// ---------------------------------------------------------------------------

describe('FR-753: external agent preferred over built-in in dispatch', () => {
  it('isBuiltInAgentReplaceable returns true when external covers all capabilities', () => {
    const replaceable = isBuiltInAgentReplaceable(
      ['llm-api', 'role:developer'],
      [{ capabilities: ['llm-api', 'role:developer', 'extra'], status: 'online', isBuiltIn: false }],
    );
    expect(replaceable).toBe(true);
  });

  it('isBuiltInAgentReplaceable returns false when external is offline', () => {
    const replaceable = isBuiltInAgentReplaceable(
      ['llm-api'],
      [{ capabilities: ['llm-api'], status: 'offline', isBuiltIn: false }],
    );
    expect(replaceable).toBe(false);
  });

  it('isBuiltInAgentReplaceable returns false when external is draining', () => {
    const replaceable = isBuiltInAgentReplaceable(
      ['llm-api'],
      [{ capabilities: ['llm-api'], status: 'draining', isBuiltIn: false }],
    );
    expect(replaceable).toBe(false);
  });

  it('isBuiltInAgentReplaceable returns false when no external candidates exist', () => {
    const replaceable = isBuiltInAgentReplaceable(['llm-api'], []);
    expect(replaceable).toBe(false);
  });

  it('selectWorkerForDispatch prefers external over built-in runtime_type', () => {
    const externalId = 'external-worker-uuid';
    const builtInId = 'built-in-worker-uuid';
    const now = new Date();

    const selected = selectWorkerForDispatch([
      {
        id: builtInId,
        runtime_type: 'internal',
        capabilities: ['llm-api'],
        task_load: 0,
        quality_score: 1,
        created_at: now,
      },
      {
        id: externalId,
        runtime_type: 'external',
        capabilities: ['llm-api'],
        task_load: 0,
        quality_score: 1,
        created_at: now,
      },
    ]);

    expect(selected).toBe(externalId);
  });

  it('selectWorkerForDispatch falls back to built-in when no external is present', () => {
    const builtInId = 'only-built-in-uuid';
    const now = new Date();

    const selected = selectWorkerForDispatch([
      {
        id: builtInId,
        runtime_type: 'internal',
        capabilities: ['llm-api', 'role:developer'],
        task_load: 0,
        quality_score: 1,
        created_at: now,
      },
    ]);

    expect(selected).toBe(builtInId);
  });
});
