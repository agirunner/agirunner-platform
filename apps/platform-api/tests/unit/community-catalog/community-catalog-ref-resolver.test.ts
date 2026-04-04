import { describe, expect, it, vi } from 'vitest';

import { CommunityCatalogRefResolver } from '../../../src/services/community-catalog/community-catalog-ref-resolver.js';

describe('CommunityCatalogRefResolver', () => {
  it('preserves an explicit community catalog ref override', async () => {
    const getSummary = vi.fn();
    const resolver = new CommunityCatalogRefResolver({
      configuredRef: 'release-candidate',
      versionReader: { getSummary } as never,
    });

    await expect(resolver.resolveRef()).resolves.toBe('release-candidate');
    expect(getSummary).not.toHaveBeenCalled();
  });

  it('derives the matching playbooks tag from the running platform version', async () => {
    const resolver = new CommunityCatalogRefResolver({
      versionReader: {
        getSummary: vi.fn().mockResolvedValue({
          platform_api: {
            component: 'platform-api',
            image: 'ghcr.io/agirunner/agirunner-platform-api:0.1.0-alpha.3',
            image_digest: 'sha256:platform',
            version: '0.1.0-alpha.3',
            revision: 'test-revision',
            status: 'Up 5 minutes',
            started_at: '2026-04-04T16:00:00.000Z',
          },
          dashboard: null,
          container_manager: null,
          runtimes: [],
        }),
      } as never,
    });

    await expect(resolver.resolveRef()).resolves.toBe('v0.1.0-alpha.3');
  });

  it('falls back to main for local or unlabeled platform builds', async () => {
    const localResolver = new CommunityCatalogRefResolver({
      versionReader: {
        getSummary: vi.fn().mockResolvedValue({
          platform_api: {
            component: 'platform-api',
            image: 'agirunner-platform-api:local',
            image_digest: null,
            version: 'local',
            revision: 'unlabeled',
            status: 'Up 5 minutes',
            started_at: '2026-04-04T16:00:00.000Z',
          },
          dashboard: null,
          container_manager: null,
          runtimes: [],
        }),
      } as never,
    });

    const unlabeledResolver = new CommunityCatalogRefResolver({
      versionReader: {
        getSummary: vi.fn().mockResolvedValue({
          platform_api: null,
          dashboard: null,
          container_manager: null,
          runtimes: [],
        }),
      } as never,
    });

    await expect(localResolver.resolveRef()).resolves.toBe('main');
    await expect(unlabeledResolver.resolveRef()).resolves.toBe('main');
  });

  it('falls back to main when the running platform version cannot be read', async () => {
    const resolver = new CommunityCatalogRefResolver({
      versionReader: {
        getSummary: vi.fn().mockRejectedValue(new Error('container manager unavailable')),
      } as never,
    });

    await expect(resolver.resolveRef()).resolves.toBe('main');
  });
});
