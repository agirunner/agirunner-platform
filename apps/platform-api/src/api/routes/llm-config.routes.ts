import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import type {
  CreateProviderInput,
  UpdateProviderInput,
  CreateModelInput,
  UpdateModelInput,
} from '../../services/model-catalog-service.js';
import { LlmDiscoveryService } from '../../services/llm-discovery-service.js';
import { getOAuthProfile } from '../../catalogs/oauth-profiles.js';

const roleModelOverrideSchema = z.object({
  provider: z.string().min(1).max(120),
  model: z.string().min(1).max(200),
  reasoning_config: z.record(z.unknown()).nullable().optional(),
});

const modelOverridesSchema = z.record(z.string().min(1).max(120), roleModelOverrideSchema);

const resolvePreviewSchema = z.object({
  roles: z.array(z.string().min(1).max(120)).optional(),
  workspace_model_overrides: modelOverridesSchema.optional(),
  workflow_model_overrides: modelOverridesSchema.optional(),
});

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

  app.post(
    '/api/v1/config/llm/resolve-preview',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const body = resolvePreviewSchema.parse(request.body ?? {});
      const workspaceOverrides = body.workspace_model_overrides ?? {};
      const workflowOverrides = body.workflow_model_overrides ?? {};
      const roles = readRequestedRoles(body.roles, workspaceOverrides, workflowOverrides);
      return {
        data: {
          roles,
          workspace_model_overrides: workspaceOverrides,
          workflow_model_overrides: workflowOverrides,
          effective_models: await resolveEffectiveModels(
            service,
            request.auth!.tenantId,
            roles,
            workspaceOverrides,
            workflowOverrides,
          ),
        },
      };
    },
  );
};

function readRequestedRoles(
  roles: string[] | undefined,
  workspaceOverrides: Record<string, unknown>,
  workflowOverrides: Record<string, unknown>,
) {
  if (Array.isArray(roles) && roles.length > 0) {
    return roles;
  }
  return Array.from(new Set([...Object.keys(workspaceOverrides), ...Object.keys(workflowOverrides)]));
}

async function resolveEffectiveModels(
  modelCatalogService: {
    resolveRoleConfig(tenantId: string, roleName: string): Promise<unknown>;
    listProviders(tenantId: string): Promise<unknown[]>;
    listModels(tenantId: string, providerId?: string): Promise<unknown[]>;
    getProviderForOperations(tenantId: string, id: string): Promise<unknown>;
  },
  tenantId: string,
  roles: string[],
  workspaceOverrides: Record<string, unknown>,
  workflowOverrides: Record<string, unknown>,
) {
  const providers = (await modelCatalogService.listProviders(tenantId)) as Array<Record<string, unknown>>;
  const byId = new Map(providers.map((provider) => [String(provider.id), provider]));
  const byName = new Map(
    providers.flatMap((provider) => {
      const record = provider as Record<string, unknown>;
      const names = [record.name, asRecord(record.metadata).providerType].filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      );
      return names.map((name) => [name, provider] as const);
    }),
  );

  const results: Record<string, unknown> = {};
  for (const role of roles) {
    const baseResolved = (await modelCatalogService.resolveRoleConfig(tenantId, role)) as
      | Record<string, unknown>
      | null;
    const workflowOverride = asRecord(workflowOverrides[role]);
    const workspaceOverride = asRecord(workspaceOverrides[role]);
    const activeOverride = Object.keys(workflowOverride).length > 0 ? workflowOverride : workspaceOverride;
    const source =
      Object.keys(workflowOverride).length > 0
        ? 'workflow'
        : Object.keys(workspaceOverride).length > 0
          ? 'workspace'
          : 'base';

    if (Object.keys(activeOverride).length === 0) {
      results[role] = {
        source,
        resolved: sanitizeResolvedConfig(baseResolved),
        fallback: baseResolved === null,
      };
      continue;
    }

    const providerRef = String(activeOverride.provider);
    const provider = byId.get(providerRef) ?? byName.get(providerRef);
    if (!provider) {
      results[role] = {
        source,
        resolved: sanitizeResolvedConfig(baseResolved),
        fallback: true,
        fallback_reason: `provider '${providerRef}' is not available`,
      };
      continue;
    }

    const models = (await modelCatalogService.listModels(
      tenantId,
      String(provider.id),
    )) as Array<Record<string, unknown>>;
    const model = models.find(
      (entry) =>
        String((entry as Record<string, unknown>).model_id) === String(activeOverride.model)
        && (entry as Record<string, unknown>).is_enabled === true,
    );
    if (!model) {
      results[role] = {
        source,
        resolved: sanitizeResolvedConfig(baseResolved),
        fallback: true,
        fallback_reason: `model '${String(activeOverride.model)}' is not enabled for provider '${providerRef}'`,
      };
      continue;
    }

    const providerDetails = (await modelCatalogService.getProviderForOperations(
      tenantId,
      String((provider as Record<string, unknown>).id),
    )) as Record<string, unknown>;
    results[role] = {
      source,
      resolved: sanitizeResolvedConfig({
        provider: {
          name: providerDetails.name,
          providerType: asRecord(providerDetails.metadata).providerType ?? providerDetails.name,
          baseUrl: providerDetails.base_url,
          authMode: providerDetails.auth_mode ?? 'api_key',
          providerId: providerDetails.auth_mode === 'oauth' ? providerDetails.id : null,
        },
        model: {
          modelId: model.model_id,
          contextWindow: model.context_window ?? null,
          endpointType: model.endpoint_type ?? null,
          reasoningConfig: model.reasoning_config ?? null,
        },
        reasoningConfig:
          activeOverride.reasoning_config === undefined
            ? (baseResolved as Record<string, unknown> | null)?.reasoningConfig ?? null
            : activeOverride.reasoning_config,
      }),
      fallback: false,
    };
  }
  return results;
}

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNullableRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
