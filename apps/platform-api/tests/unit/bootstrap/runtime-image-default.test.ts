import { describe, expect, it } from 'vitest';

import { DEFAULT_TENANT_ID } from '../../../src/db/seed.js';
import {
  DEFAULT_RUNTIME_IMAGE,
  resolveSeedRuntimeImage,
} from '../../../src/bootstrap/seed/runtime-image-default.js';
import {
  buildRuntimeDefaults,
  seedRuntimeDefaults,
} from '../../../src/bootstrap/seed/runtime-defaults.js';

describe('runtime image bootstrap defaults', () => {
  it('falls back to the local runtime tag when no override is configured', () => {
    expect(resolveSeedRuntimeImage()).toBe(DEFAULT_RUNTIME_IMAGE);
    expect(resolveSeedRuntimeImage('   ')).toBe(DEFAULT_RUNTIME_IMAGE);
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
      existingKeys: new Set(['specialist_runtime_default_image']),
    });

    await seedRuntimeDefaults(service, 'ghcr.io/agirunner/agirunner-runtime:latest');

    expect(service.createDefaultCalls).toEqual([]);
    expect(
      service.upsertDefaultCalls.some(
        (call) => call.configKey === 'specialist_runtime_default_image',
      ),
    ).toBe(false);
  });
});

function createSeedServiceMock(options?: { existingKeys?: Set<string> }) {
  const existingKeys = options?.existingKeys ?? new Set<string>();
  const getByKeyCalls: Array<{ tenantId: string; configKey: string }> = [];
  const createDefaultCalls: Array<{
    tenantId: string;
    configKey: string;
    configValue: string;
  }> = [];
  const upsertDefaultCalls: Array<{ tenantId: string; configKey: string }> = [];

  return {
    getByKeyCalls,
    createDefaultCalls,
    upsertDefaultCalls,
    async getByKey(tenantId: string, configKey: string) {
      getByKeyCalls.push({ tenantId, configKey });
      return existingKeys.has(configKey)
        ? ({
            id: 'runtime-default-id',
            tenant_id: tenantId,
            config_key: configKey,
            config_value: 'existing-image',
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
