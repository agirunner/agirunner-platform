import { describe, expect, it, vi } from 'vitest';

import { ServiceUnavailableError } from '../../../src/errors/domain-errors.js';
import {
  ContainerManagerVersionReader,
} from '../../../src/services/system-version/container-manager-version-reader.js';

describe('ContainerManagerVersionReader', () => {
  it('requests the control endpoint and forwards the parsed summary', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          platform_api: {
            component: 'platform-api',
            image: 'ghcr.io/agirunner/agirunner-platform-api:0.1.0-rc.1',
            image_digest: 'sha256:platform-api',
            version: '0.1.0-rc.1',
            revision: 'abcdef123456',
            status: 'Up 5 minutes',
            started_at: '2026-03-31T18:22:00.000Z',
          },
          dashboard: null,
          container_manager: null,
          runtimes: [],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const reader = new ContainerManagerVersionReader(
      'http://container-manager:9090',
      'control-token',
      fetcher,
    );

    const summary = await reader.getSummary();

    expect(summary.platform_api?.version).toBe('0.1.0-rc.1');
    expect(fetcher).toHaveBeenCalledWith(
      new URL('/api/v1/version-summary', 'http://container-manager:9090'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer control-token',
        }),
      }),
    );
  });

  it('raises a service unavailable error when the control endpoint fails', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response('bad gateway', { status: 502 }),
    ) as unknown as typeof fetch;

    const reader = new ContainerManagerVersionReader(
      'http://container-manager:9090',
      null,
      fetcher,
    );

    await expect(reader.getSummary()).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});
