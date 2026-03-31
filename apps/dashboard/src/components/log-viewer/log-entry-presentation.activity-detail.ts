import type { LogEntry } from '../../lib/api.js';
import { describeExecutionOperationLabel } from '../execution-inspector/execution-inspector-support.js';
import { describeToolOwner } from './log-entry-presentation.actor.js';
import {
  describeLogToolDisplay,
  readLogToolLabel,
  readMCPToolLabel,
} from './log-entry-presentation.activity-tools.js';
import { humanizeSentence, readString } from './log-entry-presentation.shared.js';

export function describeLogActivityTitle(entry: LogEntry): string {
  const mcpLabel = readMCPToolLabel(entry.payload);
  if (mcpLabel) {
    return mcpLabel;
  }
  if (entry.category === 'tool') {
    return readLogToolLabel(entry.payload) ?? 'Tool call';
  }
  if (entry.category === 'llm') {
    return 'Model call';
  }
  if (entry.category === 'api') {
    return describeApiTitle(entry.operation);
  }
  return describeExecutionOperationLabel(entry.operation);
}

export function describeLogActivityDetail(entry: LogEntry): string {
  const payload = entry.payload ?? {};
  const detail = describeBaseActivityDetail(entry, payload);
  return mergeToolActivityDetail(entry, detail);
}

function describeBaseActivityDetail(entry: LogEntry, payload: Record<string, unknown>): string {
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
  const parts = [transition, readString(payload.action), readString(payload.entity_name)].filter(
    Boolean,
  );
  return parts.join(' · ') || '-';
}

function describeRuntimeDetail(payload: Record<string, unknown>): string {
  const parts = [
    readString(payload.action),
    readString(payload.playbook_name),
    readString(payload.reason),
  ].filter(Boolean);
  return parts.join(' · ') || '-';
}

function describeContainerDetail(payload: Record<string, unknown>): string {
  const parts = [
    readString(payload.action),
    readString(payload.image),
    readString(payload.reason),
  ].filter(Boolean);
  return parts.join(' · ') || '-';
}

function describeApiTitle(operation: string): string {
  if (!operation.startsWith('api.')) {
    return describeExecutionOperationLabel(operation);
  }

  const parts = operation
    .split('.')
    .slice(2)
    .filter((part) => part.length > 0 && part !== ':param');

  if (parts.length === 0) {
    return 'API request';
  }

  if (parts.length === 1) {
    return humanizeSentence(parts[0]);
  }

  const last = parts[parts.length - 1];
  const previous = parts[parts.length - 2];
  if (last && previous && isActionWord(last)) {
    return humanizeSentence(`${singularize(previous)} ${last}`);
  }

  return humanizeSentence(last ?? '');
}

function formatTokenWindow(input: unknown, output: unknown): string | null {
  if (typeof input !== 'number' || typeof output !== 'number') {
    return null;
  }
  return `${input} -> ${output} tok`;
}

function mergeToolActivityDetail(entry: LogEntry, detail: string): string {
  const toolDisplay = describeLogToolDisplay(entry);
  if (!toolDisplay) {
    return detail;
  }

  if (entry.category === 'tool') {
    return toolDisplay === describeLogActivityTitle(entry) ? detail : toolDisplay;
  }

  if (detail === '-' || detail.trim().length === 0) {
    return toolDisplay;
  }

  return detail === toolDisplay ? detail : `${detail} · ${toolDisplay}`;
}

function isActionWord(value: string): boolean {
  return new Set([
    'fail',
    'complete',
    'start',
    'approve',
    'reject',
    'retry',
    'cancel',
    'pause',
    'resume',
    'claim',
    'register',
    'revoke',
    'create',
    'delete',
    'update',
    'patch',
  ]).has(value.toLowerCase());
}

function singularize(value: string): string {
  const normalized = value.toLowerCase();
  return normalized.endsWith('s') ? normalized.slice(0, -1) : normalized;
}
