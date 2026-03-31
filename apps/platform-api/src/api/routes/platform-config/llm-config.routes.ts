import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../../auth/fastify-auth-hook.js';
import type {
  CreateProviderInput,
  UpdateProviderInput,
  CreateModelInput,
  UpdateModelInput,
} from '../../../services/model-catalog-service.js';
import { LlmDiscoveryService } from '../../../services/llm-discovery-service.js';
import { getOAuthProfile } from '../../../catalogs/oauth-profiles.js';

export const llmConfigRoutes: FastifyPluginAsync = async (app) => {
  const service = app.modelCatalogService;
  const discoveryService = new LlmDiscoveryService();

  // --- Providers ---

  app.get(
    '/api/v1/config/llm/providers',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => ({ data: await service.listProviders(request.auth!.tenantId) }),
  );

  app.get(
    '/api/v1/config/llm/providers/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return { data: await service.getProvider(request.auth!.tenantId, params.id) };
    },
  );

  app.post(
    '/api/v1/config/llm/providers',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const result = await service.createProvider(
        request.auth!.tenantId,
        request.body as CreateProviderInput,
      );
      reply.status(201);
      return { data: result };
    },
  );

  app.put(
    '/api/v1/config/llm/providers/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await service.updateProvider(
          request.auth!.tenantId,
          params.id,
          request.body as UpdateProviderInput,
        ),
      };
    },
  );

  app.delete(
    '/api/v1/config/llm/providers/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      await service.deleteProvider(request.auth!.tenantId, params.id);
      reply.status(204);
    },
  );

  // --- Models ---

  app.get(
    '/api/v1/config/llm/models',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const query = request.query as { providerId?: string };
      return { data: await service.listModels(request.auth!.tenantId, query.providerId) };
    },
  );

  app.get(
    '/api/v1/config/llm/models/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return { data: await service.getModel(request.auth!.tenantId, params.id) };
    },
  );

  app.post(
    '/api/v1/config/llm/models',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const result = await service.createModel(
        request.auth!.tenantId,
        request.body as CreateModelInput,
      );
      reply.status(201);
      return { data: result };
    },
  );

  app.put(
    '/api/v1/config/llm/models/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      return {
        data: await service.updateModel(
          request.auth!.tenantId,
          params.id,
          request.body as UpdateModelInput,
        ),
      };
    },
  );

  app.delete(
    '/api/v1/config/llm/models/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      await service.deleteModel(request.auth!.tenantId, params.id);
      reply.status(204);
    },
  );

  // --- System Default Model ---

  app.get(
    '/api/v1/config/llm/system-default',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => ({
      data: await service.getSystemDefault(request.auth!.tenantId),
    }),
  );

  app.put(
    '/api/v1/config/llm/system-default',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const body = request.body as {
        modelId?: string | null;
        reasoningConfig?: Record<string, unknown> | null;
      };
      await service.setSystemDefault(
        request.auth!.tenantId,
        body.modelId ?? null,
        body.reasoningConfig ?? null,
      );
      return { data: await service.getSystemDefault(request.auth!.tenantId) };
    },
  );

  // --- Role-Model Assignments ---

  app.get(
    '/api/v1/config/llm/assignments',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => ({ data: await service.listAssignments(request.auth!.tenantId) }),
  );

  app.put(
    '/api/v1/config/llm/assignments/:roleName',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { roleName: string };
      const body = request.body as {
        primaryModelId?: string | null;
        reasoningConfig?: Record<string, unknown> | null;
      };
      return {
        data: await service.upsertAssignment(
          request.auth!.tenantId,
          params.roleName,
          body.primaryModelId ?? null,
          body.reasoningConfig ?? null,
        ),
      };
    },
  );

  // --- Discovery ---

  app.post(
    '/api/v1/config/llm/providers/:id/discover',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      const provider = await service.getProviderForOperations(request.auth!.tenantId, params.id);

      const authMode = (provider.auth_mode as string) ?? 'api_key';
      if (authMode === 'oauth') {
        return discoverOAuthModels(request.auth!.tenantId, params.id, provider);
      }

      const providerType = (provider.metadata as Record<string, unknown>)?.providerType as string | undefined;
      const apiKey = provider.api_key_secret_ref ?? '';

      if (!providerType) {
        reply.status(400);
        return { error: 'Provider must have providerType in metadata.' };
      }

      if (!apiKey && providerType !== 'openai-compatible') {
        reply.status(400);
        return { error: 'Provider must have an API key configured.' };
      }

      const discovered = await discoveryService.validateAndDiscover(
        providerType,
        provider.base_url,
        apiKey,
      );

      const enableAll = providerType === 'openai-compatible';
      const created = await service.bulkCreateModels(
        request.auth!.tenantId,
        params.id,
        discovered,
        enableAll,
      );

      return { data: { discovered, created } };
    },
  );

  async function discoverOAuthModels(
    tenantId: string,
    providerId: string,
    provider: Record<string, unknown>,
  ) {
    const oauthConfig = provider.oauth_config as { profile_id: string } | null;
    if (!oauthConfig?.profile_id) {
      return { data: { discovered: [], created: [] } };
    }

    const profile = getOAuthProfile(oauthConfig.profile_id);
    const discovered = profile.staticModels.map((m) => ({
      modelId: m.modelId,
      displayName: m.modelId,
      contextWindow: m.contextWindow,
      maxOutputTokens: m.maxOutputTokens,
      endpointType: m.endpointType,
      supportsToolUse: m.supportsToolUse,
      supportsVision: m.supportsVision,
      inputCostPerMillionUsd: m.inputCostPerMillionUsd,
      outputCostPerMillionUsd: m.outputCostPerMillionUsd,
      reasoningConfig: m.reasoningConfig ?? null,
    }));

    const created = await service.bulkCreateModels(
      tenantId,
      providerId,
      discovered,
      true,
    );

    return { data: { discovered, created } };
  }

  // --- Resolve ---

  app.get(
    '/api/v1/config/llm/resolve/:roleName',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { roleName: string };
      const config = await service.resolveRoleConfig(
        request.auth!.tenantId,
        params.roleName,
      );

      if (!config) {
        reply.status(404);
        return { error: 'No model configured for role' };
      }

      return { data: sanitizeResolvedConfig(config) };
    },
  );

};

function sanitizeResolvedConfig(value: unknown) {
  const record = asNullableRecord(value);
  if (!record) {
    return value;
  }

  const provider = asNullableRecord(record.provider);
  return {
    ...record,
    ...(provider ? { provider: sanitizeResolvedProvider(provider) } : {}),
  };
}

function sanitizeResolvedProvider(provider: Record<string, unknown>) {
  const {
    apiKeySecretRef: _apiKeySecretRef,
    api_key_secret_ref: _apiKeySecretRefSnake,
    accessTokenSecret: _accessTokenSecret,
    extraHeadersSecret: _extraHeadersSecret,
    oauthConfig: _oauthConfig,
    oauth_config: _oauthConfigSnake,
    oauthCredentials: _oauthCredentials,
    oauth_credentials: _oauthCredentialsSnake,
    ...safeProvider
  } = provider;
  return safeProvider;
}

function asNullableRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
