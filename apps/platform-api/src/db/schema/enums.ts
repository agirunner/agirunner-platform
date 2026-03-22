import { pgEnum } from 'drizzle-orm/pg-core';

export const taskStateEnum = pgEnum('task_state', [
  'pending',
  'ready',
  'claimed',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
  'awaiting_approval',
  'output_pending_assessment',
  'escalated',
]);

export const taskPriorityEnum = pgEnum('task_priority', ['critical', 'high', 'normal', 'low']);

export const agentStatusEnum = pgEnum('agent_status', [
  'active',
  'idle',
  'busy',
  'degraded',
  'inactive',
  'offline',
]);

export const workerStatusEnum = pgEnum('worker_status', ['online', 'busy', 'draining', 'degraded', 'disconnected', 'offline']);
export const workerConnectionModeEnum = pgEnum('worker_connection_mode', [
  'websocket',
  'sse',
  'polling',
]);

export const workerRuntimeTypeEnum = pgEnum('worker_runtime_type', [
  'internal',
  'openclaw',
  'claude_code',
  'codex',
  'acp',
  'custom',
  'external',
]);

export const apiKeyScopeEnum = pgEnum('api_key_scope', ['agent', 'worker', 'admin']);

export const eventEntityTypeEnum = pgEnum('event_entity_type', [
  'task',
  'work_item',
  'gate',
  'workflow',
  'agent',
  'worker',
  'workspace',
  'system',
]);

export const workflowStateEnum = pgEnum('workflow_state', [
  'pending',
  'active',
  'completed',
  'failed',
  'cancelled',
  'paused',
]);
