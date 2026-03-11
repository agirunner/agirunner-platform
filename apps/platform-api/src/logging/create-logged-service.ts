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

const PAST_TENSE_OVERRIDES: Record<string, string> = {
  set: 'set',
  put: 'put',
  cut: 'cut',
  skip: 'skipped',
  retry: 'retried',
};

export function methodToAction(method: string): string {
  for (const prefix of MUTATION_PREFIXES) {
    if (method.startsWith(prefix)) {
      if (PAST_TENSE_OVERRIDES[prefix]) return PAST_TENSE_OVERRIDES[prefix];
      if (prefix.endsWith('e')) return prefix + 'd';
      return prefix + 'ed';
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

          // Skip logging for polling methods that return null (e.g. claimTask with no task available).
          if (result === null || result === undefined) return result;

          const durationMs = Math.round(performance.now() - start);

          const entityId = isRecord(result) ? (result.id as string) : undefined;
          const entityName = isRecord(result) ? (result[config.nameField] as string) : undefined;
          const projectId = isRecord(result) ? ((result.projectId ?? result.project_id) as string) : undefined;
          const projectName = isRecord(result) ? ((result.projectName ?? result.project_name) as string) : undefined;
          const workflowId = isRecord(result) ? ((result.workflowId ?? result.workflow_id) as string) : undefined;
          const workflowName = isRecord(result) ? ((result.workflowName ?? result.workflow_name) as string) : undefined;
          const taskId = isRecord(result)
            ? ((result.taskId ?? result.task_id ?? (config.entityType === 'task' ? result.id : undefined)) as string)
            : undefined;
          const role = isRecord(result) ? ((result.role) as string) : undefined;
          const taskTitle = isRecord(result) ? ((result.taskTitle ?? result.task_title ?? result.title) as string) : undefined;
          const workflowPhase = isRecord(result)
            ? ((result.workflowPhase ?? result.workflow_phase ?? (isRecord(result.metadata) ? result.metadata.workflow_phase : undefined)) as string)
            : undefined;

          const operation = `${config.category}.${config.entityType}.${methodToAction(prop)}`;

          const payload: Record<string, unknown> = {
            method: prop,
            action: methodToAction(prop),
          };
          if (isRecord(result)) {
            if (result.status) payload.entity_status = result.status;
            if (result[config.nameField]) payload.entity_name = result[config.nameField];
            if (result.role) payload.role = result.role;
            if (result.claimedBy ?? result.claimed_by) payload.claimed_by = result.claimedBy ?? result.claimed_by;
            if (result.templateId ?? result.template_id) payload.template_id = result.templateId ?? result.template_id;
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
            projectName: projectName ?? undefined,
            workflowId: workflowId ?? undefined,
            workflowName: workflowName ?? undefined,
            taskId: taskId ?? undefined,
            taskTitle: taskTitle ?? undefined,
            workflowPhase: workflowPhase ?? undefined,
            role: role ?? undefined,
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
