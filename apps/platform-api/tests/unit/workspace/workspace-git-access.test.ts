import { describe, expect, it, vi } from 'vitest';

import { storeProviderSecret } from '../../../src/lib/oauth-crypto.js';
import { WorkspaceService } from '../../../src/services/workspace/workspace-service.js';
import {
  createEventService,
  createIdentity,
} from './workspace-test-helpers.js';

describe('WorkspaceService git access verification', () => {
  it('reuses a preserved encrypted token when verifying a changed repository', async () => {
    const verify = vi.fn().mockResolvedValue({
      ok: true,
      repository_url: 'https://github.com/example/private-repo.git',
      default_branch: 'release',
      branch_verified: true,
    });
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT * FROM workspaces')) {
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
                  git_token: storeProviderSecret('ghp_live_workspace_token'),
                },
              },
              memory: {},
              git_webhook_secret: null,
              is_active: true,
            }],
          };
        }
        if (sql.startsWith('UPDATE workspaces')) {
          return {
            rowCount: 1,
            rows: [],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new WorkspaceService(
      pool as never,
      createEventService() as never,
      { WEBHOOK_ENCRYPTION_KEY: 'test-encryption-key' } as never,
      { workspaceGitAccessVerifier: { verify } } as never,
    );

    const result = await service.verifyWorkspaceGitAccess(
      createIdentity() as never,
      'workspace-1',
      {
        repository_url: 'https://github.com/example/private-repo.git',
        default_branch: 'release',
        git_token_mode: 'preserve',
      },
    );

    expect(verify).toHaveBeenCalledWith({
      repositoryUrl: 'https://github.com/example/private-repo.git',
      defaultBranch: 'release',
      gitToken: 'ghp_live_workspace_token',
    });
    expect(result).toEqual({
      ok: true,
      repository_url: 'https://github.com/example/private-repo.git',
      default_branch: 'release',
      branch_verified: true,
    });
  });
});
