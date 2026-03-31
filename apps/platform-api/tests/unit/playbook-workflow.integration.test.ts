import { vi } from 'vitest';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown; headers: Record<string, unknown> }) => {
    const rawOwnerId = request.headers['x-test-owner-id'];
    const ownerId = Array.isArray(rawOwnerId) ? rawOwnerId[0] : rawOwnerId;
    request.auth = {
      id: ownerId ? `agent-key:${ownerId}` : 'test-agent-key',
      tenantId: '00000000-0000-0000-0000-000000000001',
      scope: 'agent',
      ownerType: 'agent',
      ownerId: typeof ownerId === 'string' ? ownerId : null,
      keyPrefix: typeof ownerId === 'string' ? `agent-${ownerId}` : 'test-agent',
    };
  },
  withScope: () => async () => {},
}));

import './playbook-workflow/playbook-workflow-creation-and-history.test.js';
import './playbook-workflow/playbook-workflow-launch-and-completion.test.js';
import './playbook-workflow/playbook-workflow-checkpoint-and-closure.test.js';
import './playbook-workflow/playbook-workflow-rollups.test.js';
import './playbook-workflow/playbook-workflow-dispatch.test.js';
import './playbook-workflow/playbook-workflow-child-linkage.test.js';
