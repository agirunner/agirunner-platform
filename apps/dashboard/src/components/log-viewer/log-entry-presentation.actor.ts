import type { LogEntry } from '../../lib/api.js';
import {
  describeGenericExecutionBackendSurface,
  describeGenericToolOwnerSurface,
} from '../../lib/operator-surfaces.js';
import { describeActorKindLabel } from './log-actor-presentation.js';
import { getCanonicalStageName } from './log-entry-context.js';
import { humanize } from './log-entry-presentation.shared.js';

const CATEGORY_LABELS: Record<string, string> = {
  llm: 'LLM',
  tool: 'Tool',
  agent_loop: 'Agent loop',
  task_lifecycle: 'Task lifecycle',
  runtime_lifecycle: 'Agent',
  container: 'Container',
  api: 'API',
  config: 'Config',
  auth: 'Auth',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUNTIME_PREFIX = 'agirunner-runtime-';
const DOCKER_HASH_RE = /^[0-9a-f]{12,}$/i;
const KEY_PREFIX_RE = /^(?:Key|Worker|Agent|User)\s+ar_/;

export function describeLogCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? humanize(category);
}

export function describeWorkflowStageSummary(entry: LogEntry): {
  workflow: string;
  stage: string;
} {
  const workflow = entry.workflow_name?.trim()
    ? entry.workflow_name
    : entry.workflow_id?.trim()
      ? `Workflow ${entry.workflow_id.slice(0, 8)}`
      : '-';
  const stageName = getCanonicalStageName(entry);
  return {
    workflow,
    stage: stageName ? `Stage ${stageName}` : '-',
  };
}

export function describeLogActorLabel(entry: LogEntry): string {
  return describeActorKindLabel(readActorKind(entry));
}

export function describeLogActorDetail(entry: LogEntry): string {
  if (readActorKind(entry) === 'platform_system') {
    return '-';
  }

  const parts = [readRole(entry), describeExecutionBackend(entry), describeToolOwner(entry)].filter(
    Boolean,
  );
  if (parts.length > 0) {
    return parts.join(' · ');
  }

  return humanize(entry.source) || '-';
}

export function isEscalationEntry(entry: LogEntry): boolean {
  const operation = entry.operation.toLowerCase();
  const eventType = readString(entry.payload?.event_type)?.toLowerCase() ?? '';
  const toState = readString(entry.payload?.to_state)?.toLowerCase() ?? '';
  const taskStatus = readString(entry.payload?.task_status)?.toLowerCase() ?? '';
  const entryStatus = readString(entry.status)?.toLowerCase() ?? '';

  if (
    operation.includes('escalation_depth_exceeded') ||
    eventType.includes('escalation_depth_exceeded')
  ) {
    return false;
  }

  return (
    operation.includes('escalat')
    || eventType.includes('escalat')
    || toState === 'escalated'
    || taskStatus === 'escalated'
    || entryStatus === 'escalated'
  );
}

export function describeToolOwner(entry: LogEntry): string | null {
  const owner = describeGenericToolOwnerSurface(entry.tool_owner);
  return owner ? `${owner} tool` : null;
}

function readActorKind(entry: LogEntry): string {
  if (entry.actor_type === 'worker' || entry.actor_type === 'agent') {
    if (entry.role?.trim()?.toLowerCase() === 'orchestrator' || entry.is_orchestrator_task) {
      return 'orchestrator_agent';
    }
    return entry.actor_type === 'worker' ? 'specialist_agent' : 'specialist_task_execution';
  }
  if (
    entry.actor_type === 'operator' ||
    entry.actor_type === 'user' ||
    entry.actor_type === 'api_key'
  ) {
    return 'operator';
  }
  if (entry.actor_type === 'system' || looksLikeSystemActorName(entry.actor_name)) {
    return 'platform_system';
  }
  return entry.actor_type || 'platform_system';
}

function looksLikeSystemActorName(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return false;
  }
  return (
    KEY_PREFIX_RE.test(normalized) ||
    normalized.startsWith(RUNTIME_PREFIX) ||
    DOCKER_HASH_RE.test(normalized) ||
    UUID_RE.test(normalized)
  );
}

function readRole(entry: LogEntry): string | null {
  const role = entry.role ?? (entry.payload?.role as string | undefined);
  return role?.trim() ? role : null;
}

function describeExecutionBackend(entry: LogEntry): string | null {
  if (!entry.execution_backend) {
    return null;
  }
  return describeGenericExecutionBackendSurface(entry.execution_backend);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
