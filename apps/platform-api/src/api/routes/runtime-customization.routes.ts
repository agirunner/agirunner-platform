import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { ValidationError } from '../../errors/domain-errors.js';
import { sanitizeSecretLikeValue } from '../../services/secret-redaction.js';
import {
  RuntimeCustomizationProxyClient,
  type RuntimeCustomizationProxyResponse,
} from '../../runtime/customization-proxy-client.js';

const requestBodySchema = z.record(z.unknown());
const buildIdSchema = z.object({ id: z.string().min(1) });
const RUNTIME_CUSTOMIZATION_SECRET_REDACTION = 'redacted://runtime-customization-secret';

function parseRequestBody(body: unknown): Record<string, unknown> {
  const parsed = requestBodySchema.safeParse(body);
  if (parsed.success) {
    return parsed.data;
  }
  throw new ValidationError('Request body must be a JSON object');
}

function parseBuildId(params: unknown): string {
  const parsed = buildIdSchema.safeParse(params);
  if (parsed.success) {
    return parsed.data.id;
  }
  throw new ValidationError('Build id is required');
}

function createProxyClient(app: FastifyInstance): RuntimeCustomizationProxyClient {
  return new RuntimeCustomizationProxyClient({
    runtimeUrl: app.config.RUNTIME_URL,
    runtimeApiKey: app.config.RUNTIME_API_KEY,
  });
}

async function sendProxyResponse(
  reply: FastifyReply,
  response: RuntimeCustomizationProxyResponse,
): Promise<FastifyReply> {
  if (response.statusCode >= 400) {
    return reply.status(response.statusCode).send(toErrorEnvelope(response));
  }

  return reply.status(response.statusCode).send({ data: sanitizeProxyBody(response.body) });
}

function toErrorEnvelope(
  response: RuntimeCustomizationProxyResponse,
): { error: Record<string, unknown> } | Record<string, unknown> {
  const existingError = response.body.error;
  if (existingError && typeof existingError === 'object' && !Array.isArray(existingError)) {
    return sanitizeProxyBody(response.body);
  }

  return {
    error: {
      code: 'RUNTIME_CUSTOMIZATION_PROXY_ERROR',
      message: `Runtime customization request failed with HTTP ${response.statusCode}`,
      details: sanitizeProxyBody(response.body),
    },
  };
}

function sanitizeProxyBody(body: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeSecretLikeValue(body, {
    redactionValue: RUNTIME_CUSTOMIZATION_SECRET_REDACTION,
    allowSecretReferences: false,
  });
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : {};
}

export const runtimeCustomizationRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [authenticateApiKey, withScope('admin')] };

  app.get('/api/v1/runtime/customizations/status', auth, async (_request, reply) => {
    return sendProxyResponse(reply, await createProxyClient(app).getStatus());
  });

  app.post('/api/v1/runtime/customizations/validate', auth, async (request, reply) => {
    return sendProxyResponse(
      reply,
      await createProxyClient(app).validate(parseRequestBody(request.body)),
    );
  });

  app.post('/api/v1/runtime/customizations/builds', auth, async (request, reply) => {
    return sendProxyResponse(
      reply,
      await createProxyClient(app).createBuild(parseRequestBody(request.body)),
    );
  });

  app.get('/api/v1/runtime/customizations/builds/:id', auth, async (request, reply) => {
    return sendProxyResponse(
      reply,
      await createProxyClient(app).getBuild(parseBuildId(request.params)),
    );
  });

  app.post('/api/v1/runtime/customizations/links', auth, async (request, reply) => {
    return sendProxyResponse(
      reply,
      await createProxyClient(app).createLink(parseRequestBody(request.body)),
    );
  });

  app.post('/api/v1/runtime/customizations/rollback', auth, async (request, reply) => {
    return sendProxyResponse(
      reply,
      await createProxyClient(app).rollback(parseRequestBody(request.body)),
    );
  });

  app.post('/api/v1/runtime/customizations/reconstruct', auth, async (request, reply) => {
    return sendProxyResponse(
      reply,
      await createProxyClient(app).reconstruct(parseRequestBody(request.body)),
    );
  });

  app.post('/api/v1/runtime/customizations/reconstruct/export', auth, async (request, reply) => {
    return sendProxyResponse(
      reply,
      await createProxyClient(app).exportReconstructedArtifact(parseRequestBody(request.body)),
    );
  });
};
