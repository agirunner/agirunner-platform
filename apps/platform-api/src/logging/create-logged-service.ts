import { randomUUID } from 'node:crypto';

import { getRequestContext } from '../observability/request-context.js';
import { actorFromAuth } from './actor-context.js';
import type { LogService } from './log-service.js';
import { SERVICE_REGISTRY } from './service-registry.js';

const MUTATION_PREFIXES = [
  'create',
  'update',
  'patch',
  'delete',
  'softDelete',
  'remove',
  'cancel',
  'pause',
  'resume',
  'claim',
  'start',
  'complete',
  'fail',
  'approve',
  'reject',
  'retry',
  'rework',
  'skip',
  'reassign',
  'escalate',
  'drain',
  'restart',
  'revoke',
  'register',
  'signal',
  'set',
  'clear',
  'chain',
  'prune',
  'pull',
  'disconnect',
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

          // Skip logging for polling/prune/batch methods that return no-op results.
          if (result === null || result === undefined) return result;
          if (typeof result === 'number' && result === 0) return result;
          if (Array.isArray(result) && result.length === 0) return result;

          const durationMs = Math.round(performance.now() - start);
          const context = resolveLogContext(result, args, config.nameField, config.entityType);

          const operation = `${config.category}.${config.entityType}.${methodToAction(prop)}`;
          const records = collectContextRecords(result, args);

          const payload: Record<string, unknown> = {
            method: prop,
            action: methodToAction(prop),
          };
          const requestId = pickString(records, ['requestId', 'request_id']);
          if (requestId) {
            payload.request_id = requestId;
          }
          if (isRecord(result)) {
            if (result.status) payload.entity_status = result.status;
            if (result[config.nameField]) payload.entity_name = result[config.nameField];
            if (result.role) payload.role = result.role;
            if (result.claimedBy ?? result.claimed_by)
              payload.claimed_by = result.claimedBy ?? result.claimed_by;
            if (result.error && isRecord(result.error)) {
              payload.error_category = result.error.category;
              payload.error_message = result.error.message;
            }
            if (result.reason) payload.reason = result.reason;
          }

          void logService
            .insert({
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
              workspaceId: context.workspaceId,
              workspaceName: context.workspaceName,
              workflowId: context.workflowId,
              workflowName: context.workflowName,
              taskId: context.taskId,
              workItemId: context.workItemId,
              stageName: context.stageName,
              activationId: context.activationId,
              isOrchestratorTask: context.isOrchestratorTask,
              taskTitle: context.taskTitle,
              role: context.role,
              actorType: actor.type,
              actorId: actor.id,
              actorName: actor.name,
              resourceType: config.entityType,
              resourceId: context.entityId,
              resourceName: context.entityName,
            })
            .catch(() => undefined);

          return result;
        } catch (err: unknown) {
          const durationMs = Math.round(performance.now() - start);
          const operation = `${config.category}.${config.entityType}.${methodToAction(prop)}`;
          const errorObj = err instanceof Error ? err : new Error(String(err));
          const records = collectContextRecords(undefined, args);
          const context = resolveLogContext(undefined, args, config.nameField, config.entityType);
          const payload: Record<string, unknown> = {
            method: prop,
            action: methodToAction(prop),
            error_message: errorObj.message,
          };
          const requestId = pickString(records, ['requestId', 'request_id']);
          if (requestId) {
            payload.request_id = requestId;
          }

          void logService
            .insert({
              tenantId,
              traceId: ctx?.requestId ?? randomUUID(),
              spanId: randomUUID(),
              source: 'platform',
              category: config.category,
              level: 'error',
              operation,
              status: 'failed',
              durationMs,
              payload,
              error: {
                code: (errorObj as Error & { code?: string }).code ?? 'unknown',
                message: errorObj.message,
              },
              workspaceId: context.workspaceId,
              workspaceName: context.workspaceName,
              workflowId: context.workflowId,
              workflowName: context.workflowName,
              taskId: context.taskId,
              workItemId: context.workItemId,
              stageName: context.stageName,
              activationId: context.activationId,
              isOrchestratorTask: context.isOrchestratorTask,
              taskTitle: context.taskTitle,
              role: context.role,
              actorType: actor.type,
              actorId: actor.id,
              actorName: actor.name,
              resourceType: config.entityType,
              resourceId: context.entityId,
              resourceName: context.entityName,
            })
            .catch(() => undefined);

          throw err;
        }
      };
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface LoggedServiceContext {
  entityId?: string;
  entityName?: string;
  workspaceId?: string;
  workspaceName?: string;
  workflowId?: string;
  workflowName?: string;
  taskId?: string;
  workItemId?: string;
  stageName?: string;
  activationId?: string;
  isOrchestratorTask?: boolean;
  taskTitle?: string;
  role?: string;
}

function resolveLogContext(
  result: unknown,
  args: unknown[],
  nameField: string,
  entityType: string,
): LoggedServiceContext {
  const records = collectContextRecords(result, args);
  const resultRecord = isRecord(result) ? result : null;
  const stageName = pickString(records, ['stageName', 'stage_name']);
  const taskId =
    pickString(records, ['taskId', 'task_id']) ??
    (entityType === 'task' ? pickString(records, ['id']) : undefined);

  return {
    entityId: resultRecord ? readString(resultRecord, ['id']) : undefined,
    entityName: resultRecord ? readString(resultRecord, [nameField]) : undefined,
    workspaceId: pickString(records, ['workspaceId', 'workspace_id']),
    workspaceName: pickString(records, ['workspaceName', 'workspace_name']),
    workflowId: pickString(records, ['workflowId', 'workflow_id']),
    workflowName: pickString(records, ['workflowName', 'workflow_name']),
    taskId,
    workItemId: pickString(records, ['workItemId', 'work_item_id']),
    stageName,
    activationId: pickString(records, ['activationId', 'activation_id']),
    isOrchestratorTask: pickBoolean(records, ['isOrchestratorTask', 'is_orchestrator_task']),
    taskTitle: pickString(records, ['taskTitle', 'task_title', 'title']),
    role: pickString(records, ['role']),
  };
}

function collectContextRecords(result: unknown, args: unknown[]): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  if (isRecord(result)) {
    records.push(result);
  }
  for (const arg of args) {
    if (isRecord(arg)) {
      records.push(arg);
    }
  }
  return records;
}

function pickString(records: Record<string, unknown>[], keys: string[]): string | undefined {
  for (const record of records) {
    const direct = readString(record, keys);
    if (direct) {
      return direct;
    }
    const metadata = metadataRecord(record);
    if (!metadata) {
      continue;
    }
    const nested = readString(metadata, keys);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

function pickBoolean(records: Record<string, unknown>[], keys: string[]): boolean | undefined {
  for (const record of records) {
    const direct = readBoolean(record, keys);
    if (direct !== undefined) {
      return direct;
    }
    const metadata = metadataRecord(record);
    if (!metadata) {
      continue;
    }
    const nested = readBoolean(metadata, keys);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
  }
  return undefined;
}

function readBoolean(record: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return undefined;
}

function metadataRecord(record: Record<string, unknown>): Record<string, unknown> | null {
  return isRecord(record.metadata) ? record.metadata : null;
}
