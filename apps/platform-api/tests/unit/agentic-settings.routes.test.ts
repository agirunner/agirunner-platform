import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../src/errors/error-handler.js';

vi.mock('../../src/auth/fastify-auth-hook.js', () => ({
  authenticateApiKey: async (request: { auth?: unknown }) => {
    request.auth = {
      id: 'key-1',
      tenantId: 'tenant-1',
      scope: 'admin',
      ownerType: 'user',
      ownerId: 'user-1',
      keyPrefix: 'admin',
    };
  },
  withScope: () => async () => {},
}));

describe('agentic settings routes', () => {
  let app: ReturnType<typeof fastify> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('reads and updates tenant live visibility settings without runtime-defaults indirection', async () => {
    const { agenticSettingsRoutes } = await import('../../src/api/routes/agentic-settings.routes.js');
    const agenticSettingsService = {
      getSettings: vi.fn(async () => ({
        live_visibility_mode_default: 'enhanced',
        assembled_prompt_warning_threshold_chars: 32000,
        scope: 'tenant',
        revision: 2,
        updated_by_operator_id: 'user-1',
        updated_at: '2026-03-27T23:00:00.000Z',
      })),
      updateSettings: vi.fn(async () => ({
        live_visibility_mode_default: 'standard',
        assembled_prompt_warning_threshold_chars: 64000,
        scope: 'tenant',
        revision: 3,
        updated_by_operator_id: 'user-1',
        updated_at: '2026-03-27T23:10:00.000Z',
      })),
    };

    app = fastify();
    registerErrorHandler(app);
    app.decorate('agenticSettingsService', agenticSettingsService as never);
    await app.register(agenticSettingsRoutes);

    const headers = { authorization: 'Bearer test' };
    const getResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/agentic-settings',
      headers,
    });
    const patchResponse = await app.inject({
      method: 'PATCH',
      url: '/api/v1/agentic-settings',
      headers,
      payload: {
        live_visibility_mode_default: 'standard',
        assembled_prompt_warning_threshold_chars: 64000,
        settings_revision: 2,
      },
    });

    expect(getResponse.statusCode).toBe(200);
    expect(patchResponse.statusCode).toBe(200);
    expect(agenticSettingsService.getSettings).toHaveBeenCalledWith('tenant-1');
    expect(agenticSettingsService.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      {
        liveVisibilityModeDefault: 'standard',
        assembledPromptWarningThresholdChars: 64000,
        settingsRevision: 2,
      },
    );
  });
});
