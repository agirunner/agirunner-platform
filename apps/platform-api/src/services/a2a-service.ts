import type { CreateTaskInput } from './task-service.types.js';

const A2A_PROTOCOL_VERSION = '0.1';

interface A2ATaskPayload {
  id?: string;
  title: string;
  description?: string;
  type?: string;
  priority?: string;
  pipeline_id?: string;
  project_id?: string;
  role?: string;
  input?: Record<string, unknown>;
  context?: Record<string, unknown>;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
  requires_approval?: boolean;
}

export function buildAgentCard(baseUrl: string) {
  return {
    protocol: 'a2a',
    protocol_version: A2A_PROTOCOL_VERSION,
    name: 'AgentBaton',
    description: 'A2A ingress and query facade over the AgentBaton task broker.',
    authentication: {
      type: 'bearer_api_key',
      header: 'Authorization',
    },
    capabilities: {
      task_submission: true,
      status_query: true,
      streaming_updates: true,
    },
    endpoints: {
      submit_task: `${baseUrl}/api/v1/a2a/tasks`,
      get_task: `${baseUrl}/api/v1/a2a/tasks/{taskId}`,
      stream_task: `${baseUrl}/api/v1/a2a/tasks/{taskId}/events`,
    },
  };
}

export function mapA2ATaskToCreateInput(task: A2ATaskPayload): CreateTaskInput {
  return {
    title: task.title,
    type: normalizeTaskType(task.type),
    description: task.description,
    priority: normalizePriority(task.priority),
    pipeline_id: task.pipeline_id,
    project_id: task.project_id,
    role: task.role,
    input: task.input ?? {},
    context: task.context ?? {},
    capabilities_required: task.capabilities ?? [],
    requires_approval: task.requires_approval,
    metadata: {
      ...(task.metadata ?? {}),
      protocol_ingress: {
        protocol: 'a2a',
        external_task_id: task.id,
      },
    },
  };
}

export function buildA2ATaskResponse(task: Record<string, unknown>) {
  return {
    id: String(task.id),
    status: mapTaskStateToA2AStatus(task.state),
    title: readString(task.title),
    created_at: readString(task.created_at),
    updated_at: readString(task.updated_at),
    result: task.output ?? null,
    metadata: {
      ...(asRecord(task.metadata).protocol_ingress ? { protocol_ingress: asRecord(task.metadata).protocol_ingress } : {}),
      task_id: task.id,
      pipeline_id: task.pipeline_id,
      project_id: task.project_id,
    },
  };
}

export function buildA2AStreamEvent(event: {
  id: number | string;
  type: string;
  entity_id: string;
  created_at: string;
  data?: Record<string, unknown>;
}) {
  return {
    id: String(event.id),
    task_id: event.entity_id,
    event_type: event.type,
    status: mapTaskStateToA2AStatus(asRecord(event.data).to_state ?? asRecord(event.data).state),
    created_at: event.created_at,
    data: event.data ?? {},
  };
}

function normalizeTaskType(value: string | undefined): CreateTaskInput['type'] {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'analysis' || normalized === 'code' || normalized === 'review' || normalized === 'test' || normalized === 'docs' || normalized === 'orchestration') {
    return normalized;
  }
  return 'custom';
}

function normalizePriority(value: string | undefined): CreateTaskInput['priority'] {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'critical' || normalized === 'high' || normalized === 'normal' || normalized === 'low') {
    return normalized;
  }
  return 'normal';
}

function mapTaskStateToA2AStatus(value: unknown) {
  switch (value) {
    case 'pending':
    case 'ready':
      return 'submitted';
    case 'claimed':
    case 'running':
    case 'output_pending_review':
      return 'working';
    case 'awaiting_approval':
    case 'blocked':
      return 'input-required';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'canceled';
    default:
      return 'submitted';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
