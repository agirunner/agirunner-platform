import { createHmac, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError, UnauthorizedError } from '../../errors/domain-errors.js';

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
  .refine((value) => value.url !== undefined || value.event_types !== undefined || value.is_active !== undefined, {
    message: 'At least one field is required',
  });

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

function parseInboundIdentity(request: FastifyRequest): InboundWebhookIdentity {
  const githubEvent = getHeaderValue(request, 'x-github-event');
  if (githubEvent) {
    return {
      provider: 'github',
      eventType: githubEvent,
      signature: getHeaderValue(request, 'x-hub-signature-256'),
      secret: request.server.config.GIT_WEBHOOK_GITHUB_SECRET,
    };
  }

  const giteaEvent = getHeaderValue(request, 'x-gitea-event');
  if (giteaEvent) {
    return {
      provider: 'gitea',
      eventType: giteaEvent,
      signature: getHeaderValue(request, 'x-gitea-signature'),
      secret: request.server.config.GIT_WEBHOOK_GITEA_SECRET,
    };
  }

  const gitlabEvent = getHeaderValue(request, 'x-gitlab-event');
  if (gitlabEvent) {
    return {
      provider: 'gitlab',
      eventType: gitlabEvent,
      signature: getHeaderValue(request, 'x-gitlab-token'),
      secret: request.server.config.GIT_WEBHOOK_GITLAB_SECRET,
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

function extractTaskId(payload: Record<string, unknown>): string | undefined {
  const texts: string[] = [];

  const pullRequest = asRecord(payload.pull_request);
  const commit = asRecord(payload.head_commit);
  const checkRun = asRecord(payload.check_run);

  [
    payload['title'],
    payload['body'],
    payload['ref'],
    pullRequest['title'],
    pullRequest['body'],
    pullRequest['head'] && asRecord(pullRequest['head'])['ref'],
    pullRequest['base'] && asRecord(pullRequest['base'])['ref'],
    commit['message'],
    checkRun['name'],
  ].forEach((value) => {
    if (typeof value === 'string' && value.length > 0) {
      texts.push(value);
    }
  });

  const taskIdPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

  for (const text of texts) {
    const match = text.match(taskIdPattern);
    if (match) {
      return match[0].toLowerCase();
    }
  }

  return undefined;
}

function mapEventType(identity: InboundWebhookIdentity, payload: Record<string, unknown>): string {
  if (identity.eventType === 'pull_request') {
    const action = String(payload.action ?? 'updated');
    if (action === 'opened') return 'task.git.pr_opened';
    if (action === 'closed' && asRecord(payload.pull_request).merged === true) {
      return 'task.git.pr_merged';
    }
    if (action === 'closed') return 'task.git.pr_closed';
    return 'task.git.pr_updated';
  }

  if (identity.eventType === 'status' || identity.eventType === 'check_run') {
    return 'task.git.ci_status_updated';
  }

  return `task.git.${identity.eventType}`;
}

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/v1/webhooks', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request, reply) => {
    const body = parseOrThrow(registerSchema.safeParse(request.body));
    const data = await app.webhookService.registerWebhook(request.auth!, body);
    return reply.status(201).send({ data });
  });

  app.patch('/api/v1/webhooks/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const body = parseOrThrow(updateSchema.safeParse(request.body));
    const data = await app.webhookService.updateWebhook(request.auth!.tenantId, params.id, body);
    return { data };
  });

  app.get('/api/v1/webhooks', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const data = await app.webhookService.listWebhooks(request.auth!.tenantId);
    return { data };
  });

  app.delete('/api/v1/webhooks/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request, reply) => {
    const params = request.params as { id: string };
    await app.webhookService.deleteWebhook(request.auth!.tenantId, params.id);
    return reply.status(204).send();
  });

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
      const identity = parseInboundIdentity(request);
      const rawBody = request.rawBody;

      if (!rawBody) {
        throw new UnauthorizedError('Webhook signature is invalid');
      }

      verifySignature(identity, rawBody);

      const payload = asRecord(request.body);
      const taskId = extractTaskId(payload);

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
      const mappedEventType = mapEventType(identity, payload);
      const gitInfo = {
        provider: identity.provider,
        event_type: identity.eventType,
        received_at: new Date().toISOString(),
        pull_request: asRecord(payload.pull_request),
        check_run: asRecord(payload.check_run),
        status: asRecord(payload)['state'],
      };

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
