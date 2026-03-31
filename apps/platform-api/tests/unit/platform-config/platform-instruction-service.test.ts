import { describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../../src/errors/domain-errors.js';
import { PlatformInstructionService } from '../../../src/services/platform-instruction-service.js';

const SECRET_ERROR =
  'platform instructions must not contain pasted credentials, tokens, or secret values; use supported secret fields instead';
const SECRET_REDACTION = 'redacted://platform-instruction-secret';

function buildIdentity() {
  return {
    id: 'key-1',
    tenantId: 'tenant-1',
    scope: 'admin',
    ownerType: 'user',
    ownerId: 'user-1',
    keyPrefix: 'prefix',
  };
}

describe('PlatformInstructionService', () => {
  it('rejects pasted secret-bearing content before any database write', async () => {
    const pool = {
      connect: vi.fn(),
    };
    const eventService = { emit: vi.fn() };
    const service = new PlatformInstructionService(pool as never, eventService as never);

    await expect(
      service.put(buildIdentity() as never, {
        content: 'OPENAI_API_KEY=sk_live_super_secret_value',
        format: 'text',
      }),
    ).rejects.toEqual(new ValidationError(SECRET_ERROR));

    expect(pool.connect).not.toHaveBeenCalled();
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('redacts secret-bearing legacy content when returning the current document', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            tenant_id: 'tenant-1',
            version: 4,
            content: 'Authorization: Bearer header.payload.signature',
            format: 'markdown',
            updated_at: new Date('2026-03-13T01:02:03.000Z'),
            updated_by_type: 'admin',
            updated_by_id: 'prefix',
          },
        ],
      }),
    };
    const service = new PlatformInstructionService(pool as never, { emit: vi.fn() } as never);

    await expect(service.getCurrent('tenant-1')).resolves.toEqual({
      tenant_id: 'tenant-1',
      version: 4,
      content: SECRET_REDACTION,
      format: 'markdown',
      updated_at: '2026-03-13T01:02:03.000Z',
      updated_by_type: 'admin',
      updated_by_id: 'prefix',
    });
  });

  it('redacts secret-bearing legacy content from version history responses', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'version-1',
              tenant_id: 'tenant-1',
              version: 7,
              content: 'api_key: github_pat_live_secret_token',
              format: 'text',
              created_at: new Date('2026-03-13T04:05:06.000Z'),
              created_by_type: 'admin',
              created_by_id: 'prefix',
            },
          ],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'version-1',
              tenant_id: 'tenant-1',
              version: 7,
              content: 'api_key: github_pat_live_secret_token',
              format: 'text',
              created_at: new Date('2026-03-13T04:05:06.000Z'),
              created_by_type: 'admin',
              created_by_id: 'prefix',
            },
          ],
        }),
    };
    const service = new PlatformInstructionService(pool as never, { emit: vi.fn() } as never);

    await expect(service.listVersions('tenant-1')).resolves.toEqual({
      data: [
        {
          id: 'version-1',
          tenant_id: 'tenant-1',
          version: 7,
          content: SECRET_REDACTION,
          format: 'text',
          created_at: '2026-03-13T04:05:06.000Z',
          created_by_type: 'admin',
          created_by_id: 'prefix',
        },
      ],
    });

    await expect(service.getVersion('tenant-1', 7)).resolves.toEqual({
      id: 'version-1',
      tenant_id: 'tenant-1',
      version: 7,
      content: SECRET_REDACTION,
      format: 'text',
      created_at: '2026-03-13T04:05:06.000Z',
      created_by_type: 'admin',
      created_by_id: 'prefix',
    });
  });
});
