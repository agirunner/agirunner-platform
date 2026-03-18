import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { authenticateApiKey, withScope } from '../../auth/fastify-auth-hook.js';
import { SchemaValidationFailedError } from '../../errors/domain-errors.js';

const scheduleTypeSchema = z.enum(['interval', 'daily_time']).default('interval');

const triggerSchema = z.object({
  name: z.string().min(1).max(255),
  source: z.string().min(1).max(255).optional(),
  workspace_id: z.string().uuid().optional(),
  workflow_id: z.string().uuid(),
  schedule_type: scheduleTypeSchema.optional(),
  cadence_minutes: z.coerce.number().int().min(1).nullable().optional(),
  daily_time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).nullable().optional(),
  timezone: z.string().min(1).nullable().optional(),
  defaults: z.record(z.unknown()).optional(),
  is_active: z.boolean().optional(),
  next_fire_at: z.string().datetime().optional(),
}).superRefine((value, ctx) => {
  const scheduleType = value.schedule_type ?? 'interval';
  if (scheduleType === 'interval') {
    if (value.cadence_minutes == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cadence_minutes'],
        message: 'cadence_minutes is required for interval schedules',
      });
    }
    if (value.daily_time != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['daily_time'],
        message: 'daily_time is only valid for daily_time schedules',
      });
    }
    if (value.timezone != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['timezone'],
        message: 'timezone is only valid for daily_time schedules',
      });
    }
    return;
  }

  if (value.daily_time == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['daily_time'],
      message: 'daily_time is required for daily_time schedules',
    });
  }
  if (value.timezone == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['timezone'],
      message: 'timezone is required for daily_time schedules',
    });
  }
  if (value.cadence_minutes != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cadence_minutes'],
      message: 'cadence_minutes must be omitted for daily_time schedules',
    });
  }
});

const triggerPatchSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    source: z.string().min(1).max(255).nullable().optional(),
    workspace_id: z.string().uuid().nullable().optional(),
    workflow_id: z.string().uuid().optional(),
    schedule_type: scheduleTypeSchema.optional(),
    cadence_minutes: z.coerce.number().int().min(1).nullable().optional(),
    daily_time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).nullable().optional(),
    timezone: z.string().min(1).nullable().optional(),
    defaults: z.record(z.unknown()).optional(),
    is_active: z.boolean().optional(),
    next_fire_at: z.string().datetime().optional(),
  })
  .superRefine((value, ctx) => {
    const scheduleType = value.schedule_type;
    if (!scheduleType) {
      return;
    }
    if (scheduleType === 'interval') {
      if (value.cadence_minutes === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cadence_minutes'],
          message: 'cadence_minutes is required for interval schedules',
        });
      }
      if (value.daily_time !== undefined && value.daily_time !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['daily_time'],
          message: 'daily_time is only valid for daily_time schedules',
        });
      }
      if (value.timezone !== undefined && value.timezone !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['timezone'],
          message: 'timezone is only valid for daily_time schedules',
        });
      }
      return;
    }

    if (value.daily_time === undefined || value.daily_time === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['daily_time'],
        message: 'daily_time is required for daily_time schedules',
      });
    }
    if (value.timezone === undefined || value.timezone === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['timezone'],
        message: 'timezone is required for daily_time schedules',
      });
    }
    if (value.cadence_minutes !== undefined && value.cadence_minutes !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cadence_minutes'],
        message: 'cadence_minutes must be omitted for daily_time schedules',
      });
    }
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

function parseOrThrow<T>(result: z.SafeParseReturnType<unknown, T>): T {
  if (result.success) {
    return result.data;
  }
  throw new SchemaValidationFailedError('Invalid request body', { issues: result.error.flatten() });
}

export const scheduledWorkItemTriggerRoutes: FastifyPluginAsync = async (app) => {
  const triggerService = app.scheduledWorkItemTriggerService;

  app.post('/api/v1/scheduled-work-item-triggers', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request, reply) => {
    const body = parseOrThrow(triggerSchema.safeParse(request.body));
    const trigger = await triggerService.createTrigger(request.auth!, body);
    return reply.status(201).send({ data: trigger });
  });

  app.get('/api/v1/scheduled-work-item-triggers', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    return triggerService.listTriggers(request.auth!.tenantId);
  });

  app.patch('/api/v1/scheduled-work-item-triggers/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const body = parseOrThrow(triggerPatchSchema.safeParse(request.body));
    const trigger = await triggerService.updateTrigger(request.auth!.tenantId, params.id, body);
    return { data: trigger };
  });

  app.delete('/api/v1/scheduled-work-item-triggers/:id', { preHandler: [authenticateApiKey, withScope('admin')] }, async (request) => {
    const params = request.params as { id: string };
    const result = await triggerService.deleteTrigger(request.auth!.tenantId, params.id);
    return { data: result };
  });
};
