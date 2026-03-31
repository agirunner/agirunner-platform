import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError } from '../../../errors/domain-errors.js';

const agenticSettingsPatchSchema = z.object({
  live_visibility_mode_default: z.enum(['standard', 'enhanced']).optional(),
  assembled_prompt_warning_threshold_chars: z.number().int().min(1).optional(),
  settings_revision: z.number().int().min(0),
}).refine(
  (value) =>
    value.live_visibility_mode_default !== undefined
    || value.assembled_prompt_warning_threshold_chars !== undefined,
  {
    message: 'At least one agentic setting must be provided',
    path: ['live_visibility_mode_default'],
  },
);

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const agenticSettingsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/v1/agentic-settings',
    { preHandler: [authenticateApiKey, withScope('agent')] },
    async (request) => ({
      data: await app.agenticSettingsService.getSettings(request.auth!.tenantId),
    }),
  );

  app.patch(
    '/api/v1/agentic-settings',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const body = parseOrThrow(agenticSettingsPatchSchema.safeParse(request.body ?? {}));
      return {
        data: await app.agenticSettingsService.updateSettings(request.auth!, {
          liveVisibilityModeDefault: body.live_visibility_mode_default,
          assembledPromptWarningThresholdChars: body.assembled_prompt_warning_threshold_chars,
          settingsRevision: body.settings_revision,
        }),
      };
    },
  );
};
