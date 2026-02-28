import { pgEnum } from 'drizzle-orm/pg-core';

export const taskStateEnum = pgEnum('task_state', [
  'pending',
  'ready',
  'claimed',
  'running',
  'completed',
  'failed',
  'cancelled',
  'awaiting_approval',
  'output_pending_review',
]);

export const taskPriorityEnum = pgEnum('task_priority', ['critical', 'high', 'normal', 'low']);
export const taskTypeEnum = pgEnum('task_type', [
  'analysis',
  'code',
  'review',
  'test',
  'docs',
  'orchestration',
  'custom',
]);

export const agentStatusEnum = pgEnum('agent_status', [
  'active',
  'idle',
  'busy',
  'degraded',
  'inactive',
  'offline',
]);

export const workerStatusEnum = pgEnum('worker_status', ['online', 'degraded', 'offline']);
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
  'pipeline',
  'agent',
  'worker',
  'project',
  'template',
  'system',
]);

export const pipelineStateEnum = pgEnum('pipeline_state', [
  'pending',
  'active',
  'completed',
  'failed',
  'cancelled',
  'paused',
]);
