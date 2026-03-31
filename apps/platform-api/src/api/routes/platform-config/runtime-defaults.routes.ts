import type { FastifyPluginAsync } from 'fastify';

import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';
import { isSecretLikeKey } from '../../../services/secret-redaction.js';
import type {
  CreateRuntimeDefaultInput,
  UpdateRuntimeDefaultInput,
} from '../../../services/runtime-defaults-service.js';

export const runtimeDefaultsRoutes: FastifyPluginAsync = async (app) => {
  const service = app.runtimeDefaultsService;

  app.get(
    '/api/v1/config/runtime-defaults',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => ({ data: await service.listDefaults(request.auth!.tenantId) }),
  );

  app.get(
    '/api/v1/config/runtime-defaults/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return { data: await service.getDefault(request.auth!.tenantId, params.id) };
    },
  );

  app.post(
    '/api/v1/config/runtime-defaults',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const input = request.body as CreateRuntimeDefaultInput;
      const previous = await service.getByKey(request.auth!.tenantId, input.configKey);
      const result = await service.upsertDefault(
        request.auth!.tenantId,
        input,
      );
      await app.eventService.emit(buildRuntimeDefaultChangeEvent({
        tenantId: request.auth!.tenantId,
        actorType: request.auth!.scope,
        actorId: request.auth!.keyPrefix,
        configKey: result.config_key,
        operation: previous ? 'update' : 'create',
        configType: result.config_type,
        descriptionPresent: Boolean(result.description),
        previousValuePresent: hasConfiguredValue(previous?.config_value),
        newValuePresent: hasConfiguredValue(result.config_value),
      }));
      reply.status(201);
      return { data: result };
    },
  );

  app.patch(
    '/api/v1/config/runtime-defaults/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      const previous = await service.getDefault(request.auth!.tenantId, params.id);
      const result = await service.updateDefault(
        request.auth!.tenantId,
        params.id,
        request.body as UpdateRuntimeDefaultInput,
      );
      await app.eventService.emit(buildRuntimeDefaultChangeEvent({
        tenantId: request.auth!.tenantId,
        actorType: request.auth!.scope,
        actorId: request.auth!.keyPrefix,
        configKey: result.config_key,
        operation: 'update',
        configType: result.config_type,
        descriptionPresent: Boolean(result.description),
        previousValuePresent: hasConfiguredValue(previous.config_value),
        newValuePresent: hasConfiguredValue(result.config_value),
      }));
      return { data: result };
    },
  );

  app.delete(
    '/api/v1/config/runtime-defaults/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const previous = await service.getDefault(request.auth!.tenantId, params.id);
      await service.deleteDefault(request.auth!.tenantId, params.id, previous.config_key);
      await app.eventService.emit(buildRuntimeDefaultChangeEvent({
        tenantId: request.auth!.tenantId,
        actorType: request.auth!.scope,
        actorId: request.auth!.keyPrefix,
        configKey: previous.config_key,
        operation: 'delete',
        configType: previous.config_type,
        descriptionPresent: Boolean(previous.description),
        previousValuePresent: hasConfiguredValue(previous.config_value),
        newValuePresent: false,
      }));
      reply.status(204);
    },
  );
};

function buildRuntimeDefaultChangeEvent(input: {
  tenantId: string;
  actorType: string;
  actorId?: string | null;
  configKey: string;
  operation: 'create' | 'update' | 'delete';
  configType: string;
  descriptionPresent: boolean;
  previousValuePresent: boolean;
  newValuePresent: boolean;
}) {
  return {
    tenantId: input.tenantId,
    type: 'config.runtime_default_changed',
    entityType: 'system' as const,
    entityId: input.tenantId,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    data: {
      config_key: input.configKey,
      operation: input.operation,
      config_type: input.configType,
      description_present: input.descriptionPresent,
      secret_redacted: isSecretLikeKey(input.configKey),
      previous_value_present: input.previousValuePresent,
      new_value_present: input.newValuePresent,
    },
  };
}

function hasConfiguredValue(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0;
}
