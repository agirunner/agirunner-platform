import { createHmac, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError, UnauthorizedError } from '../../errors/domain-errors.js';
import { NotFoundError } from '../../errors/domain-errors.js';
import {
  extractRepositoryUrl,
  extractTaskIdFromGitPayload,
  mapGitEventType,
  normalizeGitEvent,
} from '../../services/git-platform-adapter.js';

const registerSchema = z.object({
  url: z.string().url(),
  event_types: z.array(z.string().min(1)).default([]),
  secret: z.string().min(8).optional(),
});

const updateSchema = z
  .object({
    url: z.string().url().optional(),
    event_types: z.array(z.string().min(1)).optional(),
    is_active: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.url !== undefined || value.event_types !== undefined || value.is_active !== undefined,
    {
      message: 'At least one field is required',
    },
  );

interface InboundWebhookIdentity {
  provider: 'github' | 'gitea' | 'gitlab';
  eventType: string;
  signature?: string;
  secret?: string;
}

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

function getHeaderValue(request: FastifyRequest, headerName: string): string | undefined {
  const value = request.headers[headerName];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function parseInboundProvider(
  request: FastifyRequest,
): { provider: 'github' | 'gitea' | 'gitlab'; eventType: string; signature?: string } {
  const githubEvent = getHeaderValue(request, 'x-github-event');
  if (githubEvent) {
    return {
      provider: 'github',
      eventType: githubEvent,
      signature: getHeaderValue(request, 'x-hub-signature-256'),
    };
  }

  const giteaEvent = getHeaderValue(request, 'x-gitea-event');
  if (giteaEvent) {
    return {
      provider: 'gitea',
      eventType: giteaEvent,
      signature: getHeaderValue(request, 'x-gitea-signature'),
    };
  }

  const gitlabEvent = getHeaderValue(request, 'x-gitlab-event');
  if (gitlabEvent) {
    return {
      provider: 'gitlab',
      eventType: gitlabEvent,
      signature: getHeaderValue(request, 'x-gitlab-token'),
    };
  }

  throw new UnauthorizedError('Unsupported git webhook provider');
}

function getGlobalFallbackSecret(
  config: { GIT_WEBHOOK_GITHUB_SECRET?: string; GIT_WEBHOOK_GITEA_SECRET?: string; GIT_WEBHOOK_GITLAB_SECRET?: string },
  provider: 'github' | 'gitea' | 'gitlab',
): string | undefined {
  const map = {
    github: config.GIT_WEBHOOK_GITHUB_SECRET,
    gitea: config.GIT_WEBHOOK_GITEA_SECRET,
    gitlab: config.GIT_WEBHOOK_GITLAB_SECRET,
  };
  return map[provider];
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function verifySignature(identity: InboundWebhookIdentity, rawBody: Buffer): void {
  if (!identity.secret || identity.secret.length === 0 || !identity.signature) {
    throw new UnauthorizedError('Webhook signature is invalid');
  }

  if (identity.provider === 'gitlab') {
    if (!constantTimeEquals(identity.signature, identity.secret)) {
      throw new UnauthorizedError('Webhook signature is invalid');
    }
    return;
  }

  const expected = createHmac('sha256', identity.secret).update(rawBody).digest('hex');
  const provided = identity.signature.startsWith('sha256=')
    ? identity.signature.slice('sha256='.length)
    : identity.signature;

  if (!constantTimeEquals(provided, expected)) {
    throw new UnauthorizedError('Webhook signature is invalid');
  }
}

async function captureRawBody(payload: AsyncIterable<Buffer | string>): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of payload) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/v1/webhooks',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const body = parseOrThrow(registerSchema.safeParse(request.body));
      const data = await app.webhookService.registerWebhook(request.auth!, body);
      return reply.status(201).send({ data });
    },
  );

  app.patch(
    '/api/v1/webhooks/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const params = request.params as { id: string };
      const body = parseOrThrow(updateSchema.safeParse(request.body));
      const data = await app.webhookService.updateWebhook(request.auth!.tenantId, params.id, body);
      return { data };
    },
  );

  app.get(
    '/api/v1/webhooks',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request) => {
      const data = await app.webhookService.listWebhooks(request.auth!.tenantId);
      return { data };
    },
  );

  app.delete(
    '/api/v1/webhooks/:id',
    { preHandler: [authenticateApiKey, withScope('admin')] },
    async (request, reply) => {
      const params = request.params as { id: string };
      await app.webhookService.deleteWebhook(request.auth!.tenantId, params.id);
      return reply.status(204).send();
    },
  );

  app.post(
    '/api/v1/webhooks/git',
    {
      config: {
        rateLimit: {
          max: app.config.GIT_WEBHOOK_MAX_PER_MINUTE,
          timeWindow: '1 minute',
        },
      },
      preParsing: async (request, _reply, payload) => {
        const rawBody = await captureRawBody(payload);
        request.rawBody = rawBody;
        return Readable.from(rawBody);
      },
    },
    async (request, reply) => {
      const inbound = parseInboundProvider(request);
      const rawBody = request.rawBody;

      if (!rawBody) {
        throw new UnauthorizedError('Webhook signature is invalid');
      }

      const payload = asRecord(request.body);
      const repoUrl = extractRepositoryUrl(inbound.provider, payload);

      const identity = await resolveWebhookSecret(
        app,
        inbound,
        repoUrl,
        request,
      );

      verifySignature(identity, rawBody);

      const taskId = extractTaskIdFromGitPayload(payload);

      if (!taskId) {
        return reply.status(202).send({
          data: {
            accepted: true,
            provider: identity.provider,
            event_type: identity.eventType,
            mapped_task_id: null,
          },
        });
      }

      const taskLookup = await app.pgPool.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM tasks WHERE id = $1 LIMIT 1',
        [taskId],
      );

      if (!taskLookup.rowCount) {
        return reply.status(202).send({
          data: {
            accepted: true,
            provider: identity.provider,
            event_type: identity.eventType,
            mapped_task_id: taskId,
            mapped_task_found: false,
          },
        });
      }

      const tenantId = taskLookup.rows[0].tenant_id;
      const mappedEventType = mapGitEventType(identity, payload);
      const gitInfo = normalizeGitEvent(identity, payload);

      await app.pgPool.query(
        `UPDATE tasks
         SET git_info = COALESCE(git_info, '{}'::jsonb) || $3::jsonb,
             updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, taskId, gitInfo],
      );

      await app.eventService.emit({
        tenantId,
        type: mappedEventType,
        entityType: 'task',
        entityId: taskId,
        actorType: 'system',
        actorId: identity.provider,
        data: {
          provider: identity.provider,
          event_type: identity.eventType,
          action: payload.action,
        },
      });

      return reply.status(202).send({
        data: {
          accepted: true,
          provider: identity.provider,
          event_type: identity.eventType,
          mapped_task_id: taskId,
          mapped_task_found: true,
        },
      });
    },
  );
};

async function resolveWebhookSecret(
  app: { projectService: { findProjectByRepositoryUrl(url: string): Promise<{ id: string; tenant_id: string } | null>; getGitWebhookSecret(tenantId: string, projectId: string): Promise<{ provider: string; secret: string } | null> }; config: Record<string, unknown>; log: { warn(obj: Record<string, unknown>, msg: string): void } },
  inbound: { provider: 'github' | 'gitea' | 'gitlab'; eventType: string; signature?: string },
  repoUrl: string | undefined,
  request: FastifyRequest,
): Promise<InboundWebhookIdentity> {
  if (repoUrl) {
    const project = await app.projectService.findProjectByRepositoryUrl(repoUrl);
    if (project) {
      const webhookConfig = await app.projectService.getGitWebhookSecret(
        project.tenant_id,
        project.id,
      );
      if (webhookConfig) {
        return {
          provider: inbound.provider,
          eventType: inbound.eventType,
          signature: inbound.signature,
          secret: webhookConfig.secret,
        };
      }
    }
  }

  /* @deprecated — global env var fallback. Configure per-project secrets instead. */
  const globalSecret = getGlobalFallbackSecret(
    request.server.config as unknown as Record<string, string | undefined>,
    inbound.provider,
  );

  if (globalSecret) {
    app.log.warn(
      { provider: inbound.provider, repoUrl },
      'git_webhook_using_deprecated_global_secret: configure per-project git webhook secrets instead',
    );
  }

  if (!globalSecret && !repoUrl) {
    throw new NotFoundError('No matching project found for webhook');
  }

  return {
    provider: inbound.provider,
    eventType: inbound.eventType,
    signature: inbound.signature,
    secret: globalSecret,
  };
}
