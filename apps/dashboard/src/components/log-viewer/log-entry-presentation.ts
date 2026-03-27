import type { LogEntry } from '../../lib/api.js';
import { describeGenericExecutionBackendSurface, describeGenericToolOwnerSurface } from '../../lib/operator-surfaces.js';
import { describeExecutionOperationLabel } from '../execution-inspector/execution-inspector-support.js';
import { getCanonicalStageName } from './log-entry-context.js';
import { describeActorKindLabel } from './log-actor-presentation.js';

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

export function describeLogToolDisplay(entry: LogEntry): string | null {
  const invocation = readToolInvocation(entry.payload);
  if (!invocation) {
    return null;
  }
  const label = describeToolLabel(invocation.name, entry.payload);
  if (!label) {
    return null;
  }

  const summary = describeToolArgumentSummaryByName(invocation.name, invocation.input, entry.payload ?? {});
  return summary ? `${label}(${summary})` : label;
}

export function describeLogActivityTitle(entry: LogEntry): string {
  const mcpLabel = readMCPToolLabel(entry.payload);
  if (mcpLabel) {
    return mcpLabel;
  }
  if (entry.category === 'tool') {
    return readToolLabel(entry.payload) ?? 'Tool call';
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

export function isEscalationEntry(entry: LogEntry): boolean {
  const operation = entry.operation.toLowerCase();
  const eventType = readString(entry.payload?.event_type)?.toLowerCase() ?? '';
  const toState = readString(entry.payload?.to_state)?.toLowerCase() ?? '';

  if (operation.includes('escalation_depth_exceeded') || eventType.includes('escalation_depth_exceeded')) {
    return false;
  }

  return operation.includes('escalat') || eventType.includes('escalat') || toState === 'escalated';
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

function readActorKind(entry: LogEntry): string {
  if (entry.actor_type === 'worker' || entry.actor_type === 'agent') {
    if (entry.role?.trim()?.toLowerCase() === 'orchestrator' || entry.is_orchestrator_task) {
      return 'orchestrator_agent';
    }
    return entry.actor_type === 'worker'
      ? 'specialist_agent'
      : 'specialist_task_execution';
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
  if (!entry.execution_backend) {
    return null;
  }
  return describeGenericExecutionBackendSurface(entry.execution_backend);
}

function describeToolOwner(entry: LogEntry): string | null {
  const owner = describeGenericToolOwnerSurface(entry.tool_owner);
  return owner ? `${owner} tool` : null;
}

function readToolLabel(payload: Record<string, unknown> | null | undefined): string | null {
  const raw = readString(payload?.tool_name) ?? readString(payload?.command_or_path) ?? readString(payload?.command);
  return describeToolLabel(raw, payload);
}

function readActualToolLabel(payload: Record<string, unknown> | null | undefined): string | null {
  const raw = readString(payload?.tool_name);
  return describeToolLabel(raw, payload);
}

function readToolArgumentSummary(payload: Record<string, unknown> | null | undefined): string | null {
  const invocation = readToolInvocation(payload);
  return invocation ? describeToolArgumentSummaryByName(invocation.name, invocation.input, payload ?? {}) : null;
}

function describeToolLabel(
  toolName: string | null,
  payload: Record<string, unknown> | null | undefined,
): string | null {
  const mcpLabel = readMCPToolLabel(payload);
  if (mcpLabel) {
    return mcpLabel;
  }
  return toolName ? humanizeSentence(toolName) : null;
}

function readMCPToolLabel(payload: Record<string, unknown> | null | undefined): string | null {
  const serverName = readString(payload?.mcp_server_name) ?? readString(payload?.mcp_server_slug);
  const toolName = readString(payload?.mcp_tool_name);
  if (!serverName && !toolName) {
    return null;
  }

  const serverLabel = serverName ? humanizeSentence(serverName) : null;
  const toolLabel = toolName ? humanizeSentence(stripMCPServerTokens(toolName, serverName)) : null;
  if (serverLabel && toolLabel) {
    return `MCP ${serverLabel} ${lowercaseFirst(toolLabel)}`;
  }
  if (serverLabel) {
    return `MCP ${serverLabel}`;
  }
  if (toolLabel) {
    return `MCP ${toolLabel}`;
  }
  return null;
}

function stripMCPServerTokens(toolName: string, serverName: string | null): string {
  const toolTokens = tokenizeLabel(toolName);
  const serverTokens = tokenizeLabel(serverName);
  if (toolTokens.length === 0 || serverTokens.length === 0) {
    return toolName;
  }

  let start = 0;
  let end = toolTokens.length;
  if (startsWithTokens(toolTokens, serverTokens)) {
    start = serverTokens.length;
  }
  const remainingTokens = toolTokens.slice(start, end);
  if (endsWithTokens(remainingTokens, serverTokens)) {
    end -= serverTokens.length;
  }

  const trimmed = toolTokens.slice(start, end);
  return trimmed.length > 0 ? trimmed.join('_') : toolName;
}

function tokenizeLabel(value: string | null): string[] {
  if (!value) {
    return [];
  }
  return value
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0 && token !== 'mcp');
}

function startsWithTokens(value: string[], prefix: string[]): boolean {
  if (prefix.length === 0 || prefix.length > value.length) {
    return false;
  }
  return prefix.every((token, index) => value[index] === token);
}

function endsWithTokens(value: string[], suffix: string[]): boolean {
  if (suffix.length === 0 || suffix.length > value.length) {
    return false;
  }
  const startIndex = value.length - suffix.length;
  return suffix.every((token, index) => value[startIndex + index] === token);
}

function lowercaseFirst(value: string): string {
  if (value.length === 0) {
    return value;
  }
  return value.charAt(0).toLowerCase() + value.slice(1);
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

  if (isActionWord(last)) {
    return humanizeSentence(`${singularize(previous)} ${last}`);
  }

  return humanizeSentence(last);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstDefinedString(values: Array<string | null>): string | null {
  for (const value of values) {
    if (value) {
      return value;
    }
  }
  return null;
}

function truncateSummary(value: string, max = 35): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function describeToolArgumentSummaryByName(
  toolName: string | null,
  input: Record<string, unknown> | null,
  payload: Record<string, unknown>,
): string | null {
  switch (toolName) {
    case 'shell_exec':
      return truncateSummary(readString(input?.command) ?? '');
    case 'file_read':
      return formatPathRangeSummary(input);
    case 'file_write':
    case 'file_edit':
    case 'file_list':
    case 'artifact_upload':
    case 'artifact_read':
    case 'artifact_document_read':
    case 'memory_delete':
    case 'work_item_memory_read':
    case 'work_item_memory_history':
      return truncateSummary(firstDefinedString([
        readString(input?.path),
        readString(input?.logical_path),
        readString(input?.artifact_name),
        readString(input?.artifact_id),
        readString(input?.key),
      ]) ?? '');
    case 'glob':
      return formatPatternPathSummary(input);
    case 'grep':
      return formatGrepSummary(input);
    case 'git_commit':
      return truncateSummary(readString(input?.message) ?? '');
    case 'git_push':
      return truncateSummary(readString(input?.branch) ?? 'origin/HEAD');
    case 'git_diff':
      return truncateSummary(firstDefinedString([readString(input?.path), readString(input?.ref)]) ?? 'HEAD');
    case 'git_log':
      return truncateSummary(readString(input?.ref) ?? 'HEAD');
    case 'memory_read':
      return formatMemoryReadSummary(input);
    case 'memory_search':
      return truncateSummary(readString(input?.query) ?? '');
    case 'memory_write':
      return formatMemoryWriteSummary(input);
    case 'submit_handoff':
      return formatSubmitHandoffSummary(input);
    case 'read_predecessor_handoff':
    case 'git_status':
    case 'read_stage_status':
    case 'read_workflow_budget':
      return null;
    case 'read_latest_handoff':
    case 'read_handoff_chain':
    case 'read_work_item_continuity':
      return truncateSummary(readString(input?.work_item_id) ?? '');
    case 'list_work_items':
      return joinSummaryParts([
        readString(input?.stage_name),
        readString(input?.column_id),
        readString(input?.parent_work_item_id),
      ]);
    case 'list_workflow_tasks':
      return joinSummaryParts([
        readString(input?.stage_name),
        readString(input?.state),
        readString(input?.work_item_id),
      ]);
    case 'read_task_output':
    case 'read_task_status':
    case 'read_task_events':
    case 'update_task_input':
    case 'cancel_task':
    case 'retry_task':
    case 'approve_task':
    case 'approve_task_output':
    case 'request_rework':
    case 'send_task_message':
    case 'reassign_task':
      return truncateSummary(readString(input?.task_id) ?? '');
    case 'read_escalation':
      return truncateSummary(firstDefinedString([readString(input?.task_id), readString(input?.escalation_id)]) ?? '');
    case 'create_work_item':
      return joinSummaryParts([readString(input?.title), readString(input?.stage_name)]);
    case 'update_work_item':
    case 'complete_work_item':
      return truncateSummary(firstDefinedString([readString(input?.id), readString(input?.work_item_id)]) ?? '');
    case 'create_task':
      return joinSummaryParts([readString(input?.role), readString(input?.title)]);
    case 'request_gate_approval':
      return truncateSummary(readString(input?.stage_name) ?? '');
    case 'advance_stage':
      return joinSummaryParts([readString(input?.stage_name), readString(input?.to_stage_name)]);
    case 'complete_workflow':
      return null;
    case 'create_workflow':
      return joinSummaryParts([readString(input?.name), readString(input?.playbook_id)]);
    case 'web_fetch':
      return truncateSummary(readString(input?.url) ?? '');
    case 'spawn_agent':
      return truncateSummary(readString(input?.description) ?? '');
    default:
      return formatGenericToolSummary(input, payload);
  }
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

function formatPathRangeSummary(input: Record<string, unknown> | null): string | null {
  const path = readString(input?.path);
  if (!path) {
    return null;
  }
  const offset = readOptionalInt(input?.offset);
  const limit = readOptionalInt(input?.limit);
  if (!offset || !limit) {
    return truncateSummary(path);
  }
  return truncateSummary(`${path}:${offset}-${offset + limit - 1}`);
}

function formatPatternPathSummary(input: Record<string, unknown> | null): string | null {
  const pattern = readString(input?.pattern);
  const path = readString(input?.path);
  if (pattern && path) {
    return truncateSummary(`${pattern} @ ${path}`);
  }
  return truncateSummary(pattern ?? path ?? '');
}

function formatGrepSummary(input: Record<string, unknown> | null): string | null {
  const pattern = readString(input?.pattern);
  const path = readString(input?.path);
  if (pattern && path) {
    return truncateSummary(`${pattern} @ ${path}`);
  }
  return truncateSummary(pattern ?? path ?? '');
}

function formatMemoryReadSummary(input: Record<string, unknown> | null): string | null {
  const key = readString(input?.key);
  if (key) {
    return truncateSummary(key);
  }
  const keys = readStringArray(input?.keys);
  if (keys.length === 1) {
    return truncateSummary(keys[0] ?? '');
  }
  if (keys.length > 1) {
    return truncateSummary(`${keys.length} keys`);
  }
  return null;
}

function formatMemoryWriteSummary(input: Record<string, unknown> | null): string | null {
  const updates = isRecord(input?.updates) ? input?.updates : null;
  if (!updates) {
    return null;
  }
  const keys = Object.keys(updates).filter((key) => key.trim().length > 0).sort();
  if (keys.length === 0) {
    return null;
  }
  if (keys.length === 1) {
    return truncateSummary(keys[0] ?? '');
  }
  return truncateSummary(`${keys[0]}, +${keys.length - 1} more`);
}

function formatSubmitHandoffSummary(input: Record<string, unknown> | null): string | null {
  return joinSummaryParts([
    readString(input?.completion),
    readString(input?.resolution),
    readString(input?.outcome_action_applied),
  ]);
}

function formatGenericToolSummary(
  input: Record<string, unknown> | null,
  payload: Record<string, unknown>,
): string | null {
  const directSummary = firstDefinedString([
    readString(input?.command),
    readString(input?.path),
    readString(input?.query),
    readString(input?.url),
    readString(input?.handoff_id),
    readString(input?.task_id),
    readString(input?.workflow_id),
    readString(input?.work_item_id),
    readString(input?.stage_name),
    readString(input?.name),
    readString(payload.path),
  ]);

  if (directSummary) {
    return truncateSummary(directSummary);
  }

  const src = readString(input?.src);
  const dst = readString(input?.dst);
  if (src && dst) {
    return truncateSummary(`${src} -> ${dst}`);
  }

  return null;
}

function joinSummaryParts(parts: Array<string | null>): string | null {
  const values = parts
    .map((part) => part?.trim() ?? '')
    .filter((part) => part.length > 0);
  if (values.length === 0) {
    return null;
  }
  return truncateSummary(values.join(' · '));
}

function readOptionalInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function readToolInvocation(
  payload: Record<string, unknown> | null | undefined,
): { name: string; input: Record<string, unknown> | null } | null {
  if (!payload) {
    return null;
  }

  const directToolName = readString(payload.tool_name);
  if (directToolName) {
    return {
      name: directToolName,
      input: isRecord(payload.input) ? payload.input : null,
    };
  }

  const phaseToolName = readString(payload.tool);
  if (phaseToolName) {
    return {
      name: phaseToolName,
      input: isRecord(payload.input) ? payload.input : null,
    };
  }

  const responseToolCalls = Array.isArray(payload.response_tool_calls) ? payload.response_tool_calls : [];
  for (const item of responseToolCalls) {
    const invocation = readToolCallRecord(item);
    if (!invocation) {
      continue;
    }
    return invocation;
  }

  const toolCalls = Array.isArray(payload.tool_calls) ? payload.tool_calls : [];
  for (const item of toolCalls) {
    if (typeof item === 'string' && item.trim().length > 0) {
      return {
        name: item,
        input: null,
      };
    }

    const invocation = readToolCallRecord(item);
    if (!invocation) {
      continue;
    }
    return invocation;
  }

  return null;
}

function readToolCallRecord(
  value: unknown,
): { name: string; input: Record<string, unknown> | null } | null {
  if (!isRecord(value)) {
    return null;
  }

  const name =
    readString(value.name) ??
    (isRecord(value.function) ? readString(value.function.name) : null);
  if (!name) {
    return null;
  }

  const directInput = isRecord(value.input) ? value.input : null;
  if (directInput) {
    return { name, input: directInput };
  }

  const functionArguments = isRecord(value.function)
    ? parseToolArguments(value.function.arguments)
    : null;
  if (functionArguments) {
    return { name, input: functionArguments };
  }

  return { name, input: null };
}

function parseToolArguments(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function humanize(value: string): string {
  return value
    .split(/[_.\-/\s]+/g)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function humanizeSentence(value: string): string {
  const words = value
    .split(/[_.\-/\s]+/g)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase());

  if (words.length === 0) {
    return '';
  }

  const [first, ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
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
