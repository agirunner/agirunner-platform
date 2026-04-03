import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  COMMUNITY_CATALOG_ARTIFACT_LOCAL_ROOT,
  COMMUNITY_CATALOG_DASHBOARD_PORT,
  COMMUNITY_CATALOG_PLATFORM_PORT,
  COMMUNITY_CATALOG_POSTGRES_CONTAINER_NAME,
} from '../../../../../tests/integration/dashboard/lib/community-catalog-stack.constants.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
});

describe('dashboard harness platform env', () => {
  it('switches direct harness targets to the isolated playwright stack', async () => {
    process.env.PLAYWRIGHT_SKIP_WEBSERVER = '0';
    delete process.env.DASHBOARD_PORT;
    delete process.env.PLATFORM_API_PORT;
    delete process.env.ARTIFACT_LOCAL_ROOT;

    const env = await import('../../../../../tests/integration/dashboard/lib/platform-env.js');

    expect(env.DASHBOARD_BASE_URL).toBe(`http://localhost:${COMMUNITY_CATALOG_DASHBOARD_PORT}`);
    expect(env.PLATFORM_API_URL).toBe(`http://localhost:${COMMUNITY_CATALOG_PLATFORM_PORT}`);
    expect(env.POSTGRES_CONTAINER_NAME).toBe(COMMUNITY_CATALOG_POSTGRES_CONTAINER_NAME);
    expect(env.PLATFORM_ARTIFACT_LOCAL_ROOT).toBe(COMMUNITY_CATALOG_ARTIFACT_LOCAL_ROOT);
    expect(env.PLATFORM_API_CONTAINER_NAME).not.toBe('agirunner-platform-platform-api-1');
  });
});
