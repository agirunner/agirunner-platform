import type { LogEntry } from '../../lib/api.js';
import { describeExecutionOperationLabel } from '../execution-inspector/execution-inspector-support.js';
import { getCanonicalStageName } from './log-entry-context.js';
import { describeActorKindLabel } from './log-actor-presentation.js';

const CATEGORY_LABELS: Record<string, string> = {
  llm: 'LLM',
  tool: 'Tool',
  agent_loop: 'Agent loop',
  task_lifecycle: 'Task lifecycle',
  runtime_lifecycle: 'Runtime',
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

export function describeWorkflowStageSummary(entry: LogEntry): { workflow: string; stage: string } {
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

  const parts = [readRole(entry), describeExecutionBackend(entry), describeToolOwner(entry)].filter(Boolean);
  if (parts.length > 0) {
    return parts.join(' · ');
  }

  return humanize(entry.source) || '-';
}

export function describeLogActivityTitle(entry: LogEntry): string {
  if (entry.category === 'tool') {
    return readToolLabel(entry.payload) ?? 'Tool call';
  }
  if (entry.category === 'llm') {
    return 'Model call';
  }
  return describeExecutionOperationLabel(entry.operation);
}

export function describeLogActivityDetail(entry: LogEntry): string {
  const payload = entry.payload ?? {};

  switch (entry.category) {
    case 'tool':
      return describeToolOwner(entry) ?? 'Tool call';
    case 'llm':
      return describeLlmDetail(payload);
    case 'agent_loop':
      return describeAgentLoopDetail(payload);
    case 'task_lifecycle':
      return describeTaskLifecycleDetail(payload);
    case 'runtime_lifecycle':
      return describeRuntimeDetail(payload);
    case 'container':
      return describeContainerDetail(payload);
    case 'api':
      return 'API request';
    case 'config':
      return readString(payload.entity_name) ?? readString(payload.action) ?? '-';
    case 'auth':
      return readString(payload.auth_type) ?? '-';
    default:
      return '-';
  }
}

function readActorKind(entry: LogEntry): string {
  if (entry.actor_type === 'worker') {
    return entry.role?.trim()?.toLowerCase() === 'orchestrator'
      ? 'orchestrator_agent'
      : 'specialist_agent';
  }
  if (entry.actor_type === 'agent') {
    return 'specialist_task_execution';
  }
  if (entry.actor_type === 'operator' || entry.actor_type === 'user' || entry.actor_type === 'api_key') {
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
  if (entry.execution_backend === 'runtime_only') {
    return 'Runtime-only';
  }
  if (entry.execution_backend === 'runtime_plus_task') {
    return 'Runtime + task sandbox';
  }
  return null;
}

function describeToolOwner(entry: LogEntry): string | null {
  if (entry.tool_owner === 'runtime') {
    return 'Runtime tool';
  }
  if (entry.tool_owner === 'task') {
    return 'Task sandbox tool';
  }
  return null;
}

function readToolLabel(payload: Record<string, unknown> | null | undefined): string | null {
  const raw = readString(payload?.tool_name) ?? readString(payload?.command_or_path) ?? readString(payload?.command);
  return raw ? humanize(raw) : null;
}

function describeLlmDetail(payload: Record<string, unknown>): string {
  const parts = [
    readString(payload.model),
    formatTokenWindow(payload.input_tokens, payload.output_tokens),
  ].filter(Boolean);
  return parts.join(' · ') || '-';
}

function describeAgentLoopDetail(payload: Record<string, unknown>): string {
  const parts = [
    typeof payload.iteration === 'number' ? `Iteration ${payload.iteration}` : null,
    readString(payload.decision) ?? readString(payload.summary) ?? readString(payload.approach),
  ].filter(Boolean);
  return parts.join(' · ') || '-';
}

function describeTaskLifecycleDetail(payload: Record<string, unknown>): string {
  const transition =
    readString(payload.from_state) && readString(payload.to_state)
      ? `${readString(payload.from_state)} -> ${readString(payload.to_state)}`
      : readString(payload.task_status);
  const parts = [transition, readString(payload.action), readString(payload.entity_name)].filter(Boolean);
  return parts.join(' · ') || '-';
}

function describeRuntimeDetail(payload: Record<string, unknown>): string {
  const parts = [readString(payload.action), readString(payload.playbook_name), readString(payload.reason)].filter(Boolean);
  return parts.join(' · ') || '-';
}

function describeContainerDetail(payload: Record<string, unknown>): string {
  const parts = [readString(payload.action), readString(payload.image), readString(payload.reason)].filter(Boolean);
  return parts.join(' · ') || '-';
}

function formatTokenWindow(input: unknown, output: unknown): string | null {
  if (typeof input !== 'number' || typeof output !== 'number') {
    return null;
  }
  return `${input} -> ${output} tok`;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function humanize(value: string): string {
  return value
    .split(/[_.\-/\s]+/g)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
