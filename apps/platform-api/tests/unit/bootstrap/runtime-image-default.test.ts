import { describe, expect, it } from 'vitest';

import { DEFAULT_TENANT_ID } from '../../../src/db/seed.js';
import { seedOrchestratorWorker } from '../../../src/bootstrap/seed/bootstrap-content.js';
import type { DatabaseQueryable } from '../../../src/db/database.js';
import {
  DEFAULT_RUNTIME_IMAGE,
  deriveManagedRuntimeImage,
  isManagedRuntimeImageAlias,
  resolveSeedRuntimeImage,
} from '../../../src/bootstrap/seed/runtime-image-default.js';
import {
  buildRuntimeDefaults,
  seedRuntimeDefaults,
} from '../../../src/bootstrap/seed/runtime-defaults.js';

const TEST_RELEASE_VERSION = '9.8.7-rc.1';
const TEST_RELEASE_RUNTIME_IMAGE = `ghcr.io/agirunner/agirunner-runtime:${TEST_RELEASE_VERSION}`;

describe('runtime image bootstrap defaults', () => {
  it('falls back to the local runtime tag when the platform version is local or unlabeled', () => {
    expect(resolveSeedRuntimeImage(undefined, undefined)).toBe(DEFAULT_RUNTIME_IMAGE);
    expect(resolveSeedRuntimeImage('   ', '')).toBe(DEFAULT_RUNTIME_IMAGE);
    expect(resolveSeedRuntimeImage(undefined, 'local')).toBe(DEFAULT_RUNTIME_IMAGE);
    expect(resolveSeedRuntimeImage(undefined, 'unlabeled')).toBe(DEFAULT_RUNTIME_IMAGE);
  });

  it('derives the matching published runtime image from a released platform version', () => {
    expect(resolveSeedRuntimeImage(undefined, TEST_RELEASE_VERSION)).toBe(TEST_RELEASE_RUNTIME_IMAGE);
    expect(deriveManagedRuntimeImage('0.1.0')).toBe(
      'ghcr.io/agirunner/agirunner-runtime:0.1.0',
    );
  });

  it('preserves an explicit runtime image override when one is configured', () => {
    expect(resolveSeedRuntimeImage('ghcr.io/custom/runtime:9.9.9', TEST_RELEASE_VERSION)).toBe(
      'ghcr.io/custom/runtime:9.9.9',
    );
  });

  it('classifies only moving defaults as managed runtime aliases', () => {
    expect(isManagedRuntimeImageAlias('ghcr.io/agirunner/agirunner-runtime:latest')).toBe(true);
    expect(isManagedRuntimeImageAlias('agirunner-runtime:local')).toBe(true);
    expect(isManagedRuntimeImageAlias(TEST_RELEASE_RUNTIME_IMAGE)).toBe(false);
    expect(isManagedRuntimeImageAlias('ghcr.io/custom/runtime@sha256:deadbeef')).toBe(false);
  });

  it('uses the configured runtime image for seeded specialist defaults', () => {
    const runtimeImage = 'ghcr.io/agirunner/agirunner-runtime:latest';
    const defaults = buildRuntimeDefaults(runtimeImage);

    expect(
      defaults.find((item) => item.configKey === 'specialist_runtime_default_image'),
    ).toMatchObject({
      configKey: 'specialist_runtime_default_image',
      configValue: runtimeImage,
    });
  });

  it('seeds the runtime image only when the default is still missing', async () => {
    const service = createSeedServiceMock();

    await seedRuntimeDefaults(service, 'ghcr.io/agirunner/agirunner-runtime:latest');

    expect(service.getByKeyCalls).toEqual([
      {
        tenantId: DEFAULT_TENANT_ID,
        configKey: 'specialist_runtime_default_image',
      },
    ]);
    expect(service.createDefaultCalls).toEqual([
      {
        tenantId: DEFAULT_TENANT_ID,
        configKey: 'specialist_runtime_default_image',
        configValue: 'ghcr.io/agirunner/agirunner-runtime:latest',
      },
    ]);
  });

  it('does not overwrite a runtime image changed later through the product', async () => {
    const service = createSeedServiceMock({
      existingDefaults: new Map([
        [
          'specialist_runtime_default_image',
          TEST_RELEASE_RUNTIME_IMAGE,
        ],
      ]),
    });

    await seedRuntimeDefaults(service, 'ghcr.io/agirunner/agirunner-runtime:latest');

    expect(service.createDefaultCalls).toEqual([]);
    expect(
      service.upsertDefaultCalls.some(
        (call) => call.configKey === 'specialist_runtime_default_image',
      ),
    ).toBe(false);
  });

  it('normalizes an existing managed specialist runtime alias to the derived release image', async () => {
    const service = createSeedServiceMock({
      existingDefaults: new Map([
        ['specialist_runtime_default_image', 'ghcr.io/agirunner/agirunner-runtime:latest'],
      ]),
    });

    await seedRuntimeDefaults(service, TEST_RELEASE_RUNTIME_IMAGE);

    expect(service.createDefaultCalls).toEqual([]);
    expect(service.upsertDefaultCalls).toContainEqual({
      tenantId: DEFAULT_TENANT_ID,
      configKey: 'specialist_runtime_default_image',
      configValue: TEST_RELEASE_RUNTIME_IMAGE,
    });
  });

  it('normalizes the legacy local specialist runtime alias in released builds', async () => {
    const service = createSeedServiceMock({
      existingDefaults: new Map([['specialist_runtime_default_image', 'agirunner-runtime:local']]),
    });

    await seedRuntimeDefaults(service, TEST_RELEASE_RUNTIME_IMAGE);

    expect(service.upsertDefaultCalls).toContainEqual({
      tenantId: DEFAULT_TENANT_ID,
      configKey: 'specialist_runtime_default_image',
      configValue: TEST_RELEASE_RUNTIME_IMAGE,
    });
  });

  it('preserves an existing explicit specialist runtime override', async () => {
    const service = createSeedServiceMock({
      existingDefaults: new Map([
        ['specialist_runtime_default_image', 'ghcr.io/custom/runtime@sha256:deadbeef'],
      ]),
    });

    await seedRuntimeDefaults(service, TEST_RELEASE_RUNTIME_IMAGE);

    expect(service.createDefaultCalls).toEqual([]);
    expect(
      service.upsertDefaultCalls.some(
        (call) => call.configKey === 'specialist_runtime_default_image',
      ),
    ).toBe(false);
  });

  it('normalizes an existing orchestrator managed alias to the derived release image', async () => {
    const db = createSeedDbMock({
      workerDesiredState: {
        id: 'orchestrator-row',
        runtime_image: 'ghcr.io/agirunner/agirunner-runtime:latest',
      },
    });

    await seedOrchestratorWorker(db, TEST_RELEASE_RUNTIME_IMAGE);

    expect(db.calls).toHaveLength(2);
    expect(db.calls[1]).toMatchObject({
      params: [
        TEST_RELEASE_RUNTIME_IMAGE,
        'orchestrator-row',
        DEFAULT_TENANT_ID,
      ],
    });
    expect(db.calls[1]?.sql).toContain('UPDATE worker_desired_state');
  });

  it('preserves an existing explicit orchestrator runtime override', async () => {
    const db = createSeedDbMock({
      workerDesiredState: {
        id: 'orchestrator-row',
        runtime_image: 'ghcr.io/custom/runtime:9.9.9',
      },
    });

    await seedOrchestratorWorker(db, TEST_RELEASE_RUNTIME_IMAGE);

    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]?.sql).toContain('FROM worker_desired_state');
  });
});

function createSeedServiceMock(options?: { existingDefaults?: Map<string, string> }) {
  const existingDefaults = options?.existingDefaults ?? new Map<string, string>();
  const getByKeyCalls: Array<{ tenantId: string; configKey: string }> = [];
  const createDefaultCalls: Array<{
    tenantId: string;
    configKey: string;
    configValue: string;
  }> = [];
  const upsertDefaultCalls: Array<{
    tenantId: string;
    configKey: string;
    configValue: string;
  }> = [];

  return {
    getByKeyCalls,
    createDefaultCalls,
    upsertDefaultCalls,
    async getByKey(tenantId: string, configKey: string) {
      getByKeyCalls.push({ tenantId, configKey });
      return existingDefaults.has(configKey)
        ? ({
            id: 'runtime-default-id',
            tenant_id: tenantId,
            config_key: configKey,
            config_value: existingDefaults.get(configKey) ?? 'existing-image',
            config_type: 'string',
            description: 'existing',
            created_at: new Date('2026-03-31T00:00:00Z'),
            updated_at: new Date('2026-03-31T00:00:00Z'),
          } as const)
        : null;
    },
    async createDefault(
      tenantId: string,
      input: { configKey: string; configValue: string; configType: string },
    ) {
      createDefaultCalls.push({
        tenantId,
        configKey: input.configKey,
        configValue: input.configValue,
      });
      return {
        id: 'created-id',
        tenant_id: tenantId,
        config_key: input.configKey,
        config_value: input.configValue,
        config_type: input.configType,
        description: null,
        created_at: new Date('2026-03-31T00:00:00Z'),
        updated_at: new Date('2026-03-31T00:00:00Z'),
      };
    },
    async upsertDefault(
      tenantId: string,
      input: { configKey: string; configValue: string; configType: string },
    ) {
      upsertDefaultCalls.push({
        tenantId,
        configKey: input.configKey,
        configValue: input.configValue,
      });
      return {
        id: 'upserted-id',
        tenant_id: tenantId,
        config_key: input.configKey,
        config_value: input.configValue,
        config_type: input.configType,
        description: null,
        created_at: new Date('2026-03-31T00:00:00Z'),
        updated_at: new Date('2026-03-31T00:00:00Z'),
      };
    },
  };
}

function createSeedDbMock(options?: {
  workerDesiredState?: { id: string; runtime_image: string } | null;
}): DatabaseQueryable & { calls: Array<{ sql: string; params?: unknown[] }> } {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const workerDesiredState = options?.workerDesiredState ?? null;
  const query = (async (queryTextOrConfig: unknown, values?: unknown[]) => {
    const sql = extractSql(queryTextOrConfig);
    const params = Array.isArray(values) ? values : undefined;

    calls.push({ sql, params });
    if (sql.includes('FROM worker_desired_state')) {
      return {
        rowCount: workerDesiredState ? 1 : 0,
        rows: workerDesiredState ? [workerDesiredState] : [],
      };
    }

    return {
      rowCount: 1,
      rows: [],
    };
  }) as DatabaseQueryable['query'];

  return { calls, query };
}

function extractSql(queryTextOrConfig: unknown): string {
  if (typeof queryTextOrConfig === 'string') {
    return queryTextOrConfig;
  }
  if (
    queryTextOrConfig &&
    typeof queryTextOrConfig === 'object' &&
    'text' in queryTextOrConfig &&
    typeof (queryTextOrConfig as { text?: unknown }).text === 'string'
  ) {
    return (queryTextOrConfig as { text: string }).text;
  }
  return '';
}
