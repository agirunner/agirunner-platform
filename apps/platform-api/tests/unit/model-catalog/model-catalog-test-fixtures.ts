import { configureProviderSecretEncryptionKey } from '../../../src/lib/oauth-crypto.js';
import { ModelCatalogService } from '../../../src/services/model-catalog/model-catalog-service.js';

import { vi } from 'vitest';

function createMockPool() {
  return { query: vi.fn() };
}

export const TENANT_ID = '00000000-0000-0000-0000-000000000001';
export const PROVIDER_ID = '00000000-0000-0000-0000-000000000010';
export const MODEL_ID = '00000000-0000-0000-0000-000000000020';

export const sampleProvider = {
  id: PROVIDER_ID,
  tenant_id: TENANT_ID,
  name: 'anthropic',
  base_url: 'https://api.anthropic.com',
  api_key_secret_ref: null,
  auth_mode: 'api_key',
  is_enabled: true,
  rate_limit_rpm: null,
  metadata: { providerType: 'anthropic' },
  created_at: new Date(),
  updated_at: new Date(),
};

export const sampleModel = {
  id: MODEL_ID,
  tenant_id: TENANT_ID,
  provider_id: PROVIDER_ID,
  model_id: 'claude-sonnet-4-6',
  context_window: 200000,
  max_output_tokens: 8192,
  supports_tool_use: true,
  supports_vision: true,
  input_cost_per_million_usd: '3.00',
  output_cost_per_million_usd: '15.00',
  is_enabled: true,
  endpoint_type: 'chat',
  reasoning_config: null,
  created_at: new Date(),
};

export const sampleNativeSearch = {
  mode: 'anthropic_web_search_20250305',
  defaultEnabled: true,
};

export function createServiceHarness() {
  process.env.WEBHOOK_ENCRYPTION_KEY = 'test-encryption-key';
  configureProviderSecretEncryptionKey(process.env.WEBHOOK_ENCRYPTION_KEY);

  const pool = createMockPool();
  const service = new ModelCatalogService(pool as never);
  return { pool, service };
}
