import type { LogRow } from '../../logging/log-service.js';

import type { WorkflowHistoryItem, WorkflowLiveConsoleItem } from './workflow-operations-types.js';

const LIVE_CONSOLE_AGENT_LOOP_OPERATIONS = new Set([
  'agent.think',
  'agent.plan',
  'agent.act',
  'agent.observe',
  'agent.verify',
]);

const HISTORY_LIFECYCLE_OPERATIONS = new Set([
  'task_lifecycle.workflow.state_changed',
  'task_lifecycle.task.claimed',
  'task_lifecycle.task.started',
  'task_lifecycle.task.completed',
]);

export function buildExecutionTurnItems(rows: LogRow[]): WorkflowLiveConsoleItem[] {
  return rows
    .filter((row) => LIVE_CONSOLE_AGENT_LOOP_OPERATIONS.has(row.operation))
    .filter((row) => shouldRenderExecutionTurn(row))
    .map((row) => ({
      item_id: `execution-log:${row.id}`,
      item_kind: 'execution_turn',
      source_kind: readLogSourceKind(row),
      source_label: readLogSourceLabel(row),
      headline: buildExecutionTurnHeadline(row),
      summary: buildExecutionTurnSummary(row),
      created_at: normalizeTimestamp(row.created_at),
      work_item_id: row.work_item_id,
      task_id: row.task_id,
      linked_target_ids: buildLinkedTargetIds(row),
    }));
}

export function buildLifecycleHistoryItems(rows: LogRow[]): WorkflowHistoryItem[] {
  return rows
    .filter((row) => HISTORY_LIFECYCLE_OPERATIONS.has(row.operation))
    .map((row) => ({
      item_id: `lifecycle-log:${row.id}`,
      item_kind: 'lifecycle_event',
      source_kind: readLogSourceKind(row),
      source_label: readLogSourceLabel(row),
      headline: buildLifecycleHeadline(row),
      summary: buildLifecycleSummary(row),
      created_at: normalizeTimestamp(row.created_at),
      work_item_id: row.work_item_id,
      task_id: row.task_id,
      linked_target_ids: buildLinkedTargetIds(row),
    }));
}

function buildExecutionTurnHeadline(row: LogRow): string {
  const payload = asRecord(row.payload);
  const subject = readExecutionSubject(row);
  switch (row.operation) {
    case 'agent.think':
      return (
        readThinkText(payload)
        ?? buildSubjectHeadline('Thinking through the next step for', subject, 'Thinking through the next step')
      );
    case 'agent.plan':
      return (
        readPlanText(payload)
        ?? buildSubjectHeadline('Planning the next step for', subject, 'Planning the next step')
      );
    case 'agent.act': {
      const actionHeadline = buildActionInvocationHeadline(payload);
      return (
        readOperatorReadableField(payload, ['headline', 'text_preview'])
        ?? actionHeadline
        ?? buildSubjectHeadline('Working through', subject, 'Working through the next execution step')
      );
    }
    case 'agent.observe':
      return (
        readObserveText(payload)
        ?? buildSubjectHeadline('Checking results for', subject, 'Checking execution results')
      );
    case 'agent.verify':
      return (
        readVerifyText(payload)
        ?? readOperatorReadableText(buildVerifyHeadline(payload), 180)
        ?? buildSubjectHeadline('Checking', subject, 'Checking current progress')
      );
    default:
      return humanizeToken(row.operation);
  }
}

function buildExecutionTurnSummary(row: LogRow): string {
  const payload = asRecord(row.payload);
  const subject = readExecutionSubject(row);
  const detail =
    readObserveText(payload)
    ?? readVerifyText(payload)
    ?? readOperatorReadableField(payload, ['summary', 'details', 'reasoning_summary', 'approach'])
    ?? buildExecutionTurnFallbackSummary(row.operation, subject);
  if (!detail) {
    return humanizeToken(row.operation);
  }
  return detail;
}

function buildLifecycleHeadline(row: LogRow): string {
  const payload = asRecord(row.payload);
  const entityName = readString(payload.entity_name) ?? row.task_title ?? 'Task';
  const sourceLabel = readLogSourceLabel(row);
  switch (row.operation) {
    case 'task_lifecycle.workflow.state_changed': {
      const nextState = readString(payload.to_state);
      return nextState ? `Workflow moved to ${humanizeToken(nextState)}` : 'Workflow state changed';
    }
    case 'task_lifecycle.task.claimed':
      return `${sourceLabel} claimed ${entityName}`;
    case 'task_lifecycle.task.started':
      return `${sourceLabel} started ${entityName}`;
    case 'task_lifecycle.task.completed':
      return `${sourceLabel} completed ${entityName}`;
    default:
      return humanizeToken(row.operation);
  }
}

function buildLifecycleSummary(row: LogRow): string {
  const payload = asRecord(row.payload);
  if (row.operation === 'task_lifecycle.workflow.state_changed') {
    const fromState = readString(payload.from_state);
    const toState = readString(payload.to_state);
    const workflowName = readString(payload.workflow_name) ?? row.workflow_name;
    const pieces = [
      fromState ? `from ${humanizeToken(fromState)}` : null,
      toState ? `to ${humanizeToken(toState)}` : null,
      workflowName ? `workflow ${workflowName}` : null,
    ].filter((value): value is string => value !== null);
    return pieces.length > 0 ? pieces.join(' · ') : 'Workflow state changed';
  }

  const requestId = readString(payload.request_id);
  const method = readString(payload.method);
  const action = readString(payload.action);
  const pieces = [
    action ? `action ${humanizeToken(action)}` : null,
    method ? `via ${method}` : null,
    requestId ? `request ${requestId}` : null,
  ].filter((value): value is string => value !== null);
  return pieces.length > 0 ? pieces.join(' · ') : humanizeToken(row.operation);
}

function buildVerifyHeadline(payload: Record<string, unknown>): string | null {
  const status = readString(payload.status);
  const decision = readString(payload.decision);
  if (status && decision) {
    return `Verification ${humanizeToken(status)}: ${humanizeToken(decision)}`;
  }
  if (status) {
    return `Verification ${humanizeToken(status)}`;
  }
  if (decision) {
    return `Verification ${humanizeToken(decision)}`;
  }
  return null;
}

function buildActionInvocationHeadline(payload: Record<string, unknown>): string | null {
  const actionName =
    readString(payload.mcp_tool_name)
    ?? readString(payload.tool)
    ?? readString(payload.action)
    ?? readString(payload.command);
  if (!actionName) {
    return null;
  }
  const args = summarizeActionArgs(actionName, asRecord(payload.input));
  if (args.length === 0) {
    if (shouldSuppressEmptyActionInvocation(actionName)) {
      return null;
    }
    return `calling ${actionName}()`;
  }
  return `calling ${actionName}(${args.join(', ')})`;
}

function shouldRenderExecutionTurn(row: LogRow): boolean {
  const payload = asRecord(row.payload);
  switch (row.operation) {
    case 'agent.think':
      return readThinkText(payload) !== null;
    case 'agent.plan':
      return readPlanText(payload) !== null;
    case 'agent.act':
      return (
        !isSuppressedActionName(readActionName(payload))
        && (
          readOperatorReadableField(payload, ['headline', 'text_preview']) !== null
          || buildActionInvocationHeadline(payload) !== null
        )
      );
    case 'agent.observe':
      return readObserveText(payload) !== null;
    case 'agent.verify':
      return readVerifyText(payload) !== null;
    default:
      return true;
  }
}

function readExecutionSubject(row: LogRow): string | null {
  return (
    readString(row.task_title)
    ?? readString(row.resource_name)
    ?? readString(row.workflow_name)
  );
}

function buildSubjectHeadline(prefix: string, subject: string | null, fallback: string): string {
  if (!subject) {
    return fallback;
  }
  return `${prefix} ${subject}`;
}

function summarizeActionArgs(actionName: string, input: Record<string, unknown>): string[] {
  const specializedArgs = summarizeToolSpecificArgs(actionName, input);
  if (specializedArgs.length > 0) {
    return specializedArgs;
  }

  const preferredKeys = ['summary', 'headline', 'title', 'role', 'completion', 'decision', 'stage_name'];
  const summaries: string[] = [];
  for (const key of preferredKeys) {
    const rendered = renderActionArg(key, input[key]);
    if (rendered) {
      summaries.push(rendered);
    }
    if (summaries.length >= 3) {
      return summaries;
    }
  }

  for (const [key, value] of Object.entries(input)) {
    if (preferredKeys.includes(key) || shouldSkipActionArg(key, value)) {
      continue;
    }
    const rendered = renderActionArg(key, value);
    if (rendered) {
      summaries.push(rendered);
    }
    if (summaries.length >= 3) {
      break;
    }
  }
  return summaries;
}

function summarizeToolSpecificArgs(actionName: string, input: Record<string, unknown>): string[] {
  switch (actionName) {
    case 'file_read': {
      const pathRange = formatPathRangeSummary(input);
      return pathRange ? [`path="${pathRange.replace(/"/g, "'")}"`] : [];
    }
    case 'file_write':
    case 'file_edit':
    case 'file_list':
    case 'artifact_upload':
    case 'artifact_read':
    case 'artifact_document_read': {
      const pathLike = readFirstString([
        readString(input.path),
        readString(input.logical_path),
        readString(input.artifact_name),
        readString(input.artifact_id),
      ]);
      return pathLike ? [`path="${truncate(pathLike, 72)?.replace(/"/g, "'")}"`] : [];
    }
    default:
      return [];
  }
}

function shouldSuppressEmptyActionInvocation(actionName: string): boolean {
  return new Set([
    'file_read',
    'file_write',
    'file_edit',
    'file_list',
    'artifact_upload',
    'artifact_read',
    'artifact_document_read',
  ]).has(actionName);
}

function renderActionArg(key: string, value: unknown): string | null {
  if (shouldSkipActionArg(key, value)) {
    return null;
  }
  if (typeof value === 'string') {
    const normalized = normalizeActionArgText(value);
    if (!normalized) {
      return null;
    }
    return `${key}="${normalized}"`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return `${key}=${String(value)}`;
  }
  return null;
}

function shouldSkipActionArg(key: string, value: unknown): boolean {
  if (!key.trim()) {
    return true;
  }
  if (/(^|_)(id|ids)$/.test(key) || key.endsWith('_id') || key === 'request_id') {
    return true;
  }
  if (Array.isArray(value) || (value !== null && typeof value === 'object')) {
    return true;
  }
  return false;
}

function normalizeActionArgText(value: string): string | null {
  const normalized = readOperatorReadableText(value, 72);
  if (!normalized) {
    return null;
  }
  return normalized.replace(/"/g, "'");
}

function isSuppressedActionName(value: string | null): boolean {
  return value === 'record_operator_update' || value === 'record_operator_brief';
}

function formatPathRangeSummary(input: Record<string, unknown>): string | null {
  const path = readString(input.path);
  if (!path) {
    return null;
  }
  const offset = readOptionalNumber(input.offset);
  const limit = readOptionalNumber(input.limit);
  if (offset === null || limit === null) {
    return truncate(path, 72);
  }
  return truncate(`${path}:${offset}-${offset + limit - 1}`, 72);
}

function readOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readFirstString(values: Array<string | null>): string | null {
  for (const value of values) {
    if (value) {
      return value;
    }
  }
  return null;
}

function readActionName(payload: Record<string, unknown>): string | null {
  return (
    readString(payload.mcp_tool_name)
    ?? readString(payload.tool)
    ?? readString(payload.action)
    ?? readString(payload.command)
  );
}

function readObserveText(payload: Record<string, unknown>): string | null {
  return readOperatorReadableField(payload, ['headline', 'summary', 'details', 'text_preview']);
}

function readVerifyText(payload: Record<string, unknown>): string | null {
  return readOperatorReadableField(payload, ['headline', 'summary', 'details']);
}

function readThinkText(payload: Record<string, unknown>): string | null {
  return readOperatorReadableField(payload, ['headline', 'reasoning_summary', 'approach']);
}

function readPlanText(payload: Record<string, unknown>): string | null {
  return (
    readOperatorReadableField(payload, ['headline', 'summary', 'plan_summary'])
    ?? readOperatorReadableText(readFirstPlanDescription(payload.steps), 180)
  );
}

function readFirstPlanDescription(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const description = readString((entry as Record<string, unknown>).description);
    if (description) {
      return description;
    }
  }
  return null;
}

function readLogSourceKind(row: LogRow): string {
  return readString(row.role) ?? readString(row.actor_type) ?? row.source;
}

function readLogSourceLabel(row: LogRow): string {
  return (
    readHumanizedString(row.role)
    ?? readString(row.actor_name)
    ?? readHumanizedString(row.actor_type)
    ?? humanizeToken(row.source)
  );
}

function buildLinkedTargetIds(row: LogRow): string[] {
  return [row.workflow_id, row.work_item_id, row.task_id].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return '';
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readHumanizedString(value: unknown): string | null {
  const parsed = readString(value);
  return parsed ? humanizeToken(parsed) : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(readString).filter((entry): entry is string => entry !== null);
}

function readOperatorReadableField(
  payload: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = readOperatorReadableText(readString(payload[key]), 180);
    if (value) {
      return value;
    }
  }
  return null;
}

function readOperatorReadableText(value: string | null, maxLength: number): string | null {
  const trimmed = truncate(value, maxLength);
  if (!trimmed || looksLikeRawExecutionDump(trimmed) || looksLikeLowValueConsoleText(trimmed)) {
    return null;
  }
  return trimmed;
}

function looksLikeLowValueConsoleText(value: string): boolean {
  return (
    /^advancing the task with the next verified step\.?$/i.test(value)
    || /^working through the next execution step\.?$/i.test(value)
    || /^checking current progress\.?$/i.test(value)
    || /\b(remains|still|continues to be|continues)\b.*\bready\b/i.test(value)
    || /\b(remains|still|continues to be|continues)\b.*\b(suitable|supports|cleared)\b/i.test(value)
  );
}

function looksLikeRawExecutionDump(value: string): boolean {
  return (
    value.includes('{')
    || value.includes('}')
    || value.includes('[')
    || value.includes(']')
    || /\brecord_operator_(brief|update)\b/i.test(value)
    || /\boperator (brief|update)s?\b/i.test(value)
    || /^executed\s+\d+\s+tools?/i.test(value)
    || /^signal_mutation:/i.test(value)
    || /^boundary_tool:/i.test(value)
    || /\bphase\s+\w+/i.test(value)
    || /\bturn\s+\d+\b/i.test(value)
    || /\btool steps?\b/i.test(value)
    || /\btool_failure\b/i.test(value)
    || /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(value)
  );
}

function buildExecutionTurnFallbackSummary(operation: string, subject: string | null): string {
  if (operation === 'agent.observe' || operation === 'agent.verify') {
    if (!subject) {
      return 'Checked the latest execution results.';
    }
    return `Checked the latest results for ${subject}.`;
  }
  if (!subject) {
    return 'Working through the next execution step.';
  }
  return `Working through the next step for ${subject}.`;
}

function truncate(value: string | null, maxLength: number): string | null {
  if (!value) {
    return null;
  }
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
