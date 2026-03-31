import { createHmac, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import { UnauthorizedError } from '../../../errors/domain-errors.js';
import { NotFoundError } from '../../../errors/domain-errors.js';
import {
  extractRepositoryUrl,
  extractTaskIdFromGitPayload,
  mapGitEventType,
  normalizeGitEvent,
} from '../../../services/git-platform-adapter.js';

interface InboundWebhookIdentity {
  provider: 'github' | 'gitea' | 'gitlab';
  eventType: string;
  signature?: string;
  secret?: string;
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
  app: { workspaceService: { findWorkspaceByRepositoryUrl(url: string): Promise<{ id: string; tenant_id: string } | null>; getGitWebhookSecret(tenantId: string, workspaceId: string): Promise<{ provider: string; secret: string } | null> } },
  inbound: { provider: 'github' | 'gitea' | 'gitlab'; eventType: string; signature?: string },
  repoUrl: string | undefined,
): Promise<InboundWebhookIdentity> {
  if (!repoUrl) {
    throw new NotFoundError('No matching workspace found for webhook');
  }
  const workspace = await app.workspaceService.findWorkspaceByRepositoryUrl(repoUrl);
  if (!workspace) {
    throw new NotFoundError('No matching workspace found for webhook');
  }
  const webhookConfig = await app.workspaceService.getGitWebhookSecret(
    workspace.tenant_id,
    workspace.id,
  );
  if (!webhookConfig || webhookConfig.provider !== inbound.provider) {
    throw new UnauthorizedError('No matching workspace git webhook secret is configured');
  }
  return {
    provider: inbound.provider,
    eventType: inbound.eventType,
    signature: inbound.signature,
    secret: webhookConfig.secret,
  };
}
