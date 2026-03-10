import { randomUUID } from 'node:crypto';

import { getRequestContext } from '../observability/request-context.js';
import { actorFromAuth } from './actor-context.js';
import type { LogService } from './log-service.js';
import { SERVICE_REGISTRY } from './service-registry.js';

const MUTATION_PREFIXES = [
  'create', 'update', 'patch', 'delete', 'softDelete', 'remove',
  'cancel', 'pause', 'resume', 'claim', 'start', 'complete', 'fail',
  'approve', 'reject', 'retry', 'rework', 'skip', 'reassign',
  'escalate', 'drain', 'restart', 'revoke', 'register', 'signal',
  'set', 'clear', 'chain', 'prune', 'pull', 'disconnect',
];

export function methodToAction(method: string): string {
  for (const prefix of MUTATION_PREFIXES) {
    if (method.startsWith(prefix)) {
      return prefix.endsWith('e') ? prefix + 'd' : prefix + 'ed';
    }
  }
  return method;
}

export function createLoggedService<T extends object>(
  service: T,
  serviceName: string,
  logService: LogService,
): T {
  const config = SERVICE_REGISTRY[serviceName];
  if (!config) return service;

  return new Proxy(service, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      if (typeof prop !== 'string') return value;
      if (prop.startsWith('_')) return value;
      if (config.ignoreMethods.includes(prop)) return value;
      if (!MUTATION_PREFIXES.some((prefix) => prop.startsWith(prefix))) return value;

      return async function loggedMethod(this: unknown, ...args: unknown[]) {
        const ctx = getRequestContext();
        const actor = actorFromAuth(ctx?.auth);
        const tenantId = ctx?.auth?.tenantId ?? '00000000-0000-0000-0000-000000000000';
        const start = performance.now();

        try {
          const result = await (value as Function).apply(target, args);
          const durationMs = Math.round(performance.now() - start);

          const entityId = isRecord(result) ? (result.id as string) : undefined;
          const entityName = isRecord(result) ? (result[config.nameField] as string) : undefined;
          const projectId = isRecord(result) ? ((result.projectId ?? result.project_id) as string) : undefined;
          const workflowId = isRecord(result) ? ((result.workflowId ?? result.workflow_id) as string) : undefined;
          const taskId = isRecord(result) ? ((result.taskId ?? result.task_id) as string) : undefined;

          const operation = `${config.category}.${config.entityType}.${methodToAction(prop)}`;

          const payload: Record<string, unknown> = {
            method: prop,
            action: methodToAction(prop),
          };
          if (isRecord(result)) {
            if (result.status) payload.entity_status = result.status;
            if (result.error && isRecord(result.error)) {
              payload.error_category = result.error.category;
              payload.error_message = result.error.message;
            }
            if (result.reason) payload.reason = result.reason;
          }

          void logService.insert({
            tenantId,
            traceId: ctx?.requestId ?? randomUUID(),
            spanId: randomUUID(),
            source: 'platform',
            category: config.category,
            level: 'info',
            operation,
            status: 'completed',
            durationMs,
            payload,
            projectId: projectId ?? undefined,
            workflowId: workflowId ?? undefined,
            taskId: taskId ?? undefined,
            actorType: actor.type,
            actorId: actor.id,
            actorName: actor.name,
            resourceType: config.entityType,
            resourceId: entityId ?? undefined,
            resourceName: entityName ?? undefined,
          }).catch(() => undefined);

          return result;
        } catch (err: unknown) {
          const durationMs = Math.round(performance.now() - start);
          const operation = `${config.category}.${config.entityType}.${methodToAction(prop)}`;
          const errorObj = err instanceof Error ? err : new Error(String(err));

          void logService.insert({
            tenantId,
            traceId: ctx?.requestId ?? randomUUID(),
            spanId: randomUUID(),
            source: 'platform',
            category: config.category,
            level: 'error',
            operation,
            status: 'failed',
            durationMs,
            payload: {
              method: prop,
              action: methodToAction(prop),
              error_message: errorObj.message,
            },
            error: {
              code: (errorObj as Error & { code?: string }).code ?? 'unknown',
              message: errorObj.message,
            },
            actorType: actor.type,
            actorId: actor.id,
            actorName: actor.name,
            resourceType: config.entityType,
          }).catch(() => undefined);

          throw err;
        }
      };
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
