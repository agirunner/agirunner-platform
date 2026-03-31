import { vi } from 'vitest';

import { RuntimeDefaultsService } from '../../../src/services/runtime-defaults/runtime-defaults-service.js';

export const TENANT_ID = '00000000-0000-0000-0000-000000000001';
export const DEFAULT_ID = '00000000-0000-0000-0000-000000000030';

const FIXED_TIMESTAMP = new Date('2026-03-31T00:00:00.000Z');

export const sampleDefault = {
  id: DEFAULT_ID,
  tenant_id: TENANT_ID,
  config_key: 'max_rework_attempts',
  config_value: '3',
  config_type: 'number',
  description: 'Maximum rework attempts',
  created_at: FIXED_TIMESTAMP,
  updated_at: FIXED_TIMESTAMP,
};

export const sampleSecretDefault = {
  ...sampleDefault,
  config_key: 'custom.api_key_secret_ref',
  config_value: 'legacy-plaintext-secret',
  config_type: 'string',
  description: 'Custom API key secret ref',
};

export const sampleCharsPerTokenDefault = {
  ...sampleDefault,
  config_key: 'agent.context_compaction_chars_per_token',
  config_value: '4',
  description: 'Fallback character-per-token estimate',
};

export const sampleVaultTimeoutDefault = {
  ...sampleDefault,
  config_key: 'secrets.vault_timeout_seconds',
  config_value: '10',
  description: 'Upper bound in seconds for Vault reads and revocation calls',
};

export function createMockPool() {
  return { query: vi.fn() };
}

export function createRuntimeDefaultsTestContext() {
  const pool = createMockPool();
  const fleetService = { drainAllRuntimesForTenant: vi.fn().mockResolvedValue(2) };
  const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
  const service = new RuntimeDefaultsService(pool as never, fleetService as never, eventService as never);

  return {
    pool,
    fleetService,
    eventService,
    service,
  };
}
