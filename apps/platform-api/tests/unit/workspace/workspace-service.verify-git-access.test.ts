import { describe, expect, it, vi } from 'vitest';

import {
  configureProviderSecretEncryptionKey,
  storeProviderSecret,
} from '../../../src/lib/oauth-crypto.js';
import { WorkspaceService } from '../../../src/services/workspace-service.js';

configureProviderSecretEncryptionKey('test-encryption-key');

function createIdentity() {
  return {
    tenantId: 'tenant-1',
    scope: 'admin',
    ownerType: 'tenant',
    ownerId: 'tenant-1',
    keyPrefix: 'admin-key',
    id: 'key-1',
  };
}

function createEventService() {
  return { emit: vi.fn(async () => undefined) };
}

describe('WorkspaceService git access verification', () => {
  it('returns a validation error when a preserved stored Git token cannot be decrypted', async () => {
    configureProviderSecretEncryptionKey('different-encryption-key');
    const unreadableStoredToken = storeProviderSecret('ghp_live_workspace_token');
    configureProviderSecretEncryptionKey('test-encryption-key');

    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workspaces')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workspace-1',
              tenant_id: 'tenant-1',
              name: 'Demo',
              slug: 'demo',
              description: null,
              repository_url: 'https://github.com/example/current-repo.git',
              settings: {
                credentials: {
                  git_token: unreadableStoredToken,
                },
              },
              memory: {},
              git_webhook_secret: null,
              is_active: true,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const verify = vi.fn();
    const service = new WorkspaceService(
      pool as never,
      createEventService() as never,
      { WEBHOOK_ENCRYPTION_KEY: 'test-encryption-key' } as never,
      { workspaceGitAccessVerifier: { verify } } as never,
    );

    await expect(
      service.verifyWorkspaceGitAccess(createIdentity() as never, 'workspace-1', {
        repository_url: 'https://github.com/example/private-repo.git',
        git_token_mode: 'preserve',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      message:
        'Stored Git token could not be read for verification. Replace the token before changing the repository.',
    });
    expect(verify).not.toHaveBeenCalled();
  });
});
