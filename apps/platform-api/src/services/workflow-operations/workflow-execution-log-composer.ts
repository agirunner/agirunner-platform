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
  const items: WorkflowLiveConsoleItem[] = [];

  for (const row of rows) {
    if (!LIVE_CONSOLE_AGENT_LOOP_OPERATIONS.has(row.operation) || !shouldRenderExecutionTurn(row)) {
      continue;
    }
    const scope = resolveExecutionTurnScope(row);

    const item: WorkflowLiveConsoleItem = {
      item_id: `execution-log:${row.id}`,
      item_kind: 'execution_turn',
      source_kind: readLogSourceKind(row),
      source_label: readLogSourceLabel(row),
      headline: buildExecutionTurnHeadline(row),
      summary: buildExecutionTurnSummary(row),
      created_at: normalizeTimestamp(row.created_at),
      work_item_id: scope.workItemId,
      task_id: scope.taskId,
      linked_target_ids: scope.linkedTargetIds,
      scope_binding: scope.binding,
    };
    const previousItem = items.at(-1);
    if (shouldSuppressAdjacentExecutionItem(previousItem, item)) {
      continue;
    }
    if (shouldCoalesceAdjacentExecutionItem(previousItem, item)) {
      coalesceExecutionTurnItem(previousItem!, item);
      continue;
    }
    items.push(item);
  }

  return items;
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
  const headline = (() => {
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
        const actionHeadline = buildActionHeadline(payload);
        return (
          readActText(payload, actionHeadline)
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
  })();
  return formatExecutionPhaseHeadline(row.operation, headline);
}

function buildExecutionTurnSummary(row: LogRow): string {
  const payload = asRecord(row.payload);
  const subject = readExecutionSubject(row);
  const detail =
    readActSummary(payload)
    ?? readPlanText(payload)
    ?? readThinkText(payload)
    ?? readObserveText(payload)
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

function buildActionHeadline(payload: Record<string, unknown>): string | null {
  return buildHumanizedActionHeadline(payload) ?? buildActionInvocationHeadline(payload);
}

function buildActionInvocationHeadline(payload: Record<string, unknown>): string | null {
  const actionName =
    readString(payload.mcp_tool_name)
    ?? readString(payload.tool)
    ?? readString(payload.action)
    ?? readString(payload.command);
  if (!actionName || !canRenderLiteralActionFallback(actionName)) {
    return null;
  }
  const args = summarizeActionArgs(actionName, asRecord(payload.input));
  if (args.length === 0) {
    return null;
  }
  return `calling ${actionName}(${args.join(', ')})`;
}

function readActText(
  payload: Record<string, unknown>,
  actionHeadline: string | null,
): string | null {
  const actionName = readActionName(payload);
  const explicitHeadline = readOperatorReadableField(payload, ['headline']);
  if (explicitHeadline && !looksLikeSyntheticActionPreview(explicitHeadline, actionHeadline, actionName)) {
    return explicitHeadline;
  }
  const textPreview = readOperatorReadableField(payload, ['text_preview']);
  if (textPreview && !looksLikeSyntheticActionPreview(textPreview, actionHeadline, actionName)) {
    return textPreview;
  }
  return null;
}

function readActSummary(payload: Record<string, unknown>): string | null {
  const humanizedActionHeadline = buildHumanizedActionHeadline(payload);
  const actionHeadline = humanizedActionHeadline ?? buildActionInvocationHeadline(payload);
  return (
    readActText(payload, actionHeadline)
    ?? humanizedActionHeadline
    ?? actionHeadline
  );
}

function shouldRenderExecutionTurn(row: LogRow): boolean {
  const payload = asRecord(row.payload);
  switch (row.operation) {
    case 'agent.think':
      return readThinkText(payload) !== null;
    case 'agent.plan':
      return readPlanText(payload) !== null;
    case 'agent.act': {
      const actionName = readActionName(payload);
      if (isSuppressedActionName(actionName)) {
        return false;
      }
      if (isLowValueHelperAction(actionName)) {
        return false;
      }
      return (
        (
          readOperatorReadableField(payload, ['headline', 'text_preview']) !== null
          || buildActionHeadline(payload) !== null
        )
      );
    }
    case 'agent.observe':
      return readObserveText(payload) !== null;
    case 'agent.verify':
      return isMeaningfulVerify(payload);
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
  if (isToolSpecificFallbackOnlyAction(actionName)) {
    return [];
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

function isToolSpecificFallbackOnlyAction(actionName: string): boolean {
  return (
    actionName === 'file_read'
    || actionName === 'file_write'
    || actionName === 'file_edit'
    || actionName === 'file_list'
    || actionName === 'artifact_upload'
    || actionName === 'artifact_read'
    || actionName === 'artifact_document_read'
  );
}

function isLowValueHelperAction(actionName: string | null): boolean {
  return actionName !== null && LOW_VALUE_HELPER_ACTIONS.has(actionName);
}

function canRenderLiteralActionFallback(actionName: string): boolean {
  if (isLowValueHelperAction(actionName) || isToolSpecificFallbackOnlyAction(actionName)) {
    return false;
  }
  if (LITERAL_ACTION_FALLBACK_ACTIONS.has(actionName)) {
    return true;
  }
  return /^(create|submit|update|write|edit|delete|approve|reject|reassign|assign|claim|start|complete|finish|close|open|upload|request|dispatch|resume|pause|retry|reroute|set|mark)_/i.test(
    actionName,
  );
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
        sanitizePathLikeArg(readString(input.logical_path)),
        sanitizePathLikeArg(readString(input.path)),
        sanitizePathLikeArg(readString(input.artifact_name)),
      ]);
      return pathLike ? [`path="${truncate(pathLike, 72)?.replace(/"/g, "'")}"`] : [];
    }
    default:
      return [];
  }
}

function renderActionArg(key: string, value: unknown): string | null {
  if (shouldSkipActionArg(key, value)) {
    return null;
  }
  if (typeof value === 'string') {
    const normalized = normalizeActionArgText(key, value);
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
  if (key === 'cwd') {
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

function normalizeActionArgText(key: string, value: string): string | null {
  const sanitizedPath = isPathLikeKey(key) ? sanitizePathLikeArg(value) : null;
  const normalized = readOperatorReadableText(sanitizedPath ?? value, 72);
  if (!normalized) {
    return null;
  }
  return normalized.replace(/"/g, "'");
}

function isSuppressedActionName(value: string | null): boolean {
  return value === 'record_operator_update' || value === 'record_operator_brief';
}

function buildHumanizedActionHeadline(payload: Record<string, unknown>): string | null {
  const actionName = readActionName(payload);
  const input = asRecord(payload.input);
  switch (actionName) {
    case 'submit_handoff': {
      const summary = readOperatorReadableText(readString(input.summary), 140);
      return summary ? `Submitting the handoff: ${summary}` : null;
    }
    case 'artifact_upload': {
      const path = readActionPath(input);
      return path ? `Uploading ${path}.` : null;
    }
    case 'create_task': {
      const role = readHumanizedString(input.role);
      const title = readOperatorReadableText(readString(input.title), 120);
      if (title) {
        return `Creating a task: ${title}`;
      }
      if (role) {
        return `Creating a task for ${role}.`;
      }
      return null;
    }
    default:
      return null;
  }
}

function readActionPath(input: Record<string, unknown>): string | null {
  return readFirstString([
    sanitizePathLikeArg(readString(input.logical_path)),
    sanitizePathLikeArg(readString(input.path)),
    sanitizePathLikeArg(readString(input.artifact_name)),
  ]);
}

function formatPathRangeSummary(input: Record<string, unknown>): string | null {
  const path = sanitizePathLikeArg(readString(input.path));
  if (!path) {
    return null;
  }
  if (isLogicalContextLabel(path)) {
    return path;
  }
  const offset = readOptionalNumber(input.offset);
  const limit = readOptionalNumber(input.limit);
  if (offset === null || limit === null) {
    return truncate(path, 72);
  }
  return truncate(`${path}:${offset}-${offset + limit - 1}`, 72);
}

function isLogicalContextLabel(value: string): boolean {
  return (
    value === 'task input'
    || value === 'task context'
    || value === 'workflow context'
    || value === 'workspace context'
    || value === 'workspace memory'
    || value === 'execution brief'
    || value === 'work item context'
    || value === 'execution context'
    || value === 'upstream context'
    || value === 'predecessor handoff'
    || value === 'orchestrator context'
    || value === 'activation checkpoint'
  );
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

function isPathLikeKey(key: string): boolean {
  return key === 'path' || key === 'logical_path' || key.endsWith('_path');
}

function sanitizePathLikeArg(value: string | null): string | null {
  const path = readString(value);
  if (!path) {
    return null;
  }
  const contextLabel = describeLogicalContextPath(path);
  if (contextLabel) {
    return contextLabel;
  }
  if (looksLikeSuppressedContextPath(path)) {
    return null;
  }
  if (path.startsWith('/tmp/workspace/')) {
    const relative = extractWorkspaceRelativePath(path);
    const relativeContextLabel = describeLogicalContextPath(relative);
    if (relativeContextLabel) {
      return relativeContextLabel;
    }
    if (!relative || looksLikeSuppressedContextPath(relative)) {
      return null;
    }
    return relative;
  }
  if (path.startsWith('/')) {
    return null;
  }
  if (path.startsWith('repo/')) {
    return path.slice('repo/'.length);
  }
  return path;
}

function extractWorkspaceRelativePath(path: string): string | null {
  const taskWorkspaceMatch = path.match(/^\/tmp\/workspace\/task-[^/]+\/(.+)$/);
  if (taskWorkspaceMatch?.[1]) {
    return normalizeWorkspaceRelativePath(taskWorkspaceMatch[1]);
  }
  const workspaceMatch = path.match(/^\/tmp\/workspace\/(.+)$/);
  if (workspaceMatch?.[1]) {
    return normalizeWorkspaceRelativePath(workspaceMatch[1]);
  }
  return null;
}

function normalizeWorkspaceRelativePath(relativePath: string): string | null {
  if (!relativePath) {
    return null;
  }
  if (relativePath.startsWith('repo/')) {
    return relativePath.slice('repo/'.length);
  }
  if (relativePath.startsWith('workspace/')) {
    return relativePath.slice('workspace/'.length);
  }
  return relativePath;
}

function looksLikeSuppressedContextPath(path: string): boolean {
  return (
    path === 'context'
    || path.startsWith('context/')
    || path === '/workspace/context'
    || path.startsWith('/workspace/context/')
    || path === 'workspace/context'
    || path.startsWith('workspace/context/')
  );
}

function describeLogicalContextPath(path: string | null): string | null {
  const normalized = readString(path)?.replace(/\\/g, '/');
  if (!normalized) {
    return null;
  }
  const filename = normalized.split('/').at(-1);
  switch (filename) {
    case 'task-input.json':
    case 'task-input.md':
      return 'task input';
    case 'task-context.json':
    case 'current-task.json':
    case 'current-task.md':
      return 'task context';
    case 'workflow-context.json':
    case 'current-workflow.json':
    case 'current-workflow.md':
      return 'workflow context';
    case 'workspace-context.json':
    case 'workspace-context.md':
      return 'workspace context';
    case 'workspace-memory.json':
    case 'workspace-memory.md':
      return 'workspace memory';
    case 'execution-brief.json':
    case 'execution-brief.md':
      return 'execution brief';
    case 'work-item.json':
    case 'work-item.md':
      return 'work item context';
    case 'execution-context.json':
    case 'execution-context.md':
      return 'execution context';
    case 'upstream-context.json':
    case 'upstream-context.md':
      return 'upstream context';
    case 'predecessor_handoff.json':
    case 'predecessor-handoff.json':
    case 'predecessor-handoff.md':
      return 'predecessor handoff';
    case 'orchestrator-context.json':
    case 'orchestrator-context.md':
      return 'orchestrator context';
    case 'activation-checkpoint.json':
    case 'activation-checkpoint.md':
      return 'activation checkpoint';
    default:
      return null;
  }
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

function isMeaningfulVerify(payload: Record<string, unknown>): boolean {
  const text = readVerifyText(payload);
  if (!text) {
    return false;
  }
  const status = readString(payload.status);
  const decision = readString(payload.decision);
  if (isMeaningfulVerifyToken(status) || isMeaningfulVerifyToken(decision)) {
    return true;
  }
  return /\b(blocked|waiting|wait|rework|request changes|approved|rejected|failed|complete|completed)\b/i.test(
    text,
  );
}

function isMeaningfulVerifyToken(value: string | null): boolean {
  if (!value) {
    return false;
  }
  return /^(blocked|waiting|wait|rework|request_changes|approved|rejected|failed|complete|completed)$/i.test(
    value,
  );
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

function resolveExecutionTurnScope(row: LogRow): {
  binding: 'structured_target' | 'execution_context';
  workItemId: string | null;
  taskId: string | null;
  linkedTargetIds: string[];
} {
  const payload = asRecord(row.payload);
  const targets = extractStructuredTargetIds(asRecord(payload.input));
  if (targets.workItemIds.length === 0 && targets.taskIds.length === 0) {
    return {
      binding: 'execution_context',
      workItemId: row.work_item_id,
      taskId: row.task_id,
      linkedTargetIds: buildLinkedTargetIds(row),
    };
  }

  return {
    binding: 'structured_target',
    workItemId: targets.workItemIds[0] ?? null,
    taskId: targets.taskIds[0] ?? null,
    linkedTargetIds: dedupeIds([
      row.workflow_id,
      ...targets.workItemIds,
      ...targets.taskIds,
    ]),
  };
}

function buildLinkedTargetIds(row: LogRow): string[] {
  return dedupeIds([row.workflow_id, row.work_item_id, row.task_id]);
}

function extractStructuredTargetIds(input: Record<string, unknown>): {
  workItemIds: string[];
  taskIds: string[];
} {
  const workItemIds = new Set<string>();
  const taskIds = new Set<string>();
  collectStructuredTargetIds(input, workItemIds, taskIds);
  return {
    workItemIds: Array.from(workItemIds),
    taskIds: Array.from(taskIds),
  };
}

function collectStructuredTargetIds(
  value: unknown,
  workItemIds: Set<string>,
  taskIds: Set<string>,
): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStructuredTargetIds(entry, workItemIds, taskIds);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }

  const record = value as Record<string, unknown>;
  for (const [key, entry] of Object.entries(record)) {
    if (key === 'target_id') {
      const targetType = readString(record.target_type);
      const targetId = readString(entry);
      if (targetType === 'work_item' && targetId) {
        workItemIds.add(targetId);
      }
      if (targetType === 'task' && targetId) {
        taskIds.add(targetId);
      }
      continue;
    }
    if (key === 'work_item_id' || key.endsWith('_work_item_id')) {
      const workItemId = readString(entry);
      if (workItemId) {
        workItemIds.add(workItemId);
      }
      continue;
    }
    if (key === 'task_id' || key.endsWith('_task_id')) {
      const taskId = readString(entry);
      if (taskId) {
        taskIds.add(taskId);
      }
      continue;
    }
    collectStructuredTargetIds(entry, workItemIds, taskIds);
  }
}

function dedupeIds(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    ),
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
  const normalized = normalizeConsoleText(value);
  const trimmed = truncate(normalized, maxLength);
  if (!trimmed || looksLikeRawExecutionDump(trimmed) || looksLikeLowValueConsoleText(trimmed)) {
    return null;
  }
  return trimmed;
}

function normalizeConsoleText(value: string | null): string | null {
  const parsed = readString(value);
  if (!parsed) {
    return null;
  }

  let normalized = parsed
    .replace(/[\u200B-\u200D\u2060\uFEFF\uFFFD]/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");

  let previous = '';
  while (normalized !== previous) {
    previous = normalized;
    normalized = normalized
      .replace(/^\s*(?:approach|plan|plan summary|summary|details)\s*:\s*/i, '')
      .replace(/^\s*(?:operator\s+)?(?:brief|update)\s*:\s*/i, '')
      .replace(/^\s*[•·▪◦●◆▶▷→*-]+\s*/u, '')
      .trim();
  }

  normalized = normalized.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

function looksLikeSyntheticActionPreview(
  value: string,
  actionHeadline: string | null,
  actionName: string | null,
): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('calling ')) {
    return true;
  }
  if (normalized === 'tool execution in progress') {
    return true;
  }
  if (actionName && normalized === `${actionName.toLowerCase()}()`) {
    return true;
  }
  if (actionName && normalized.startsWith(`${actionName.toLowerCase()}(`)) {
    return true;
  }
  if (!actionHeadline) {
    return false;
  }
  return normalized === actionHeadline.toLowerCase();
}

function looksLikeLowValueConsoleText(value: string): boolean {
  return (
    /^advancing the task with the next verified step\.?$/i.test(value)
    || /^working through the next execution step\.?$/i.test(value)
    || /^checking current progress\.?$/i.test(value)
    || /^burst_budget:/i.test(value)
    || /\brecord the .*?(milestone|terminal|closure|operator-visible).*?\b(brief|update)\b/i.test(value)
    || /\bemit the required .*?\b(brief|update)\b/i.test(value)
    || /\bsubmitt?(?:ing)? the required structured handoff\b/i.test(value)
    || /\bfinish this (?:heartbeat )?activation\b.*\bstructured handoff\b/i.test(value)
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

function shouldSuppressAdjacentExecutionItem(
  previousItem: WorkflowLiveConsoleItem | undefined,
  currentItem: WorkflowLiveConsoleItem,
): boolean {
  if (!previousItem) {
    return false;
  }
  const previousSummary = normalizeExecutionComparisonText(previousItem.summary);
  const currentSummary = normalizeExecutionComparisonText(currentItem.summary);
  if (!previousSummary || !currentSummary || previousSummary !== currentSummary) {
    return false;
  }
  if (!hasMatchingExecutionContext(previousItem, currentItem)) {
    return false;
  }

  const previousPhase = readExecutionItemPhase(previousItem);
  const currentPhase = readExecutionItemPhase(currentItem);
  if (!previousPhase || !currentPhase) {
    return false;
  }
  if (previousPhase === currentPhase) {
    return true;
  }
  return previousPhase === 'Verify' || currentPhase === 'Verify';
}

function shouldCoalesceAdjacentExecutionItem(
  previousItem: WorkflowLiveConsoleItem | undefined,
  currentItem: WorkflowLiveConsoleItem,
): boolean {
  if (!previousItem || !hasMatchingExecutionContext(previousItem, currentItem)) {
    return false;
  }

  const previousPhase = readExecutionItemPhase(previousItem);
  const currentPhase = readExecutionItemPhase(currentItem);
  if (!previousPhase || previousPhase !== currentPhase || previousPhase === 'Act') {
    return false;
  }

  if (!occurredWithinBurstWindow(previousItem.created_at, currentItem.created_at)) {
    return false;
  }

  const previousSummary = normalizeExecutionComparisonText(previousItem.summary);
  const currentSummary = normalizeExecutionComparisonText(currentItem.summary);
  if (!previousSummary || !currentSummary || previousSummary === currentSummary) {
    return false;
  }

  return mergeExecutionTurnText(previousItem.summary, currentItem.summary) !== null;
}

function coalesceExecutionTurnItem(
  previousItem: WorkflowLiveConsoleItem,
  currentItem: WorkflowLiveConsoleItem,
): void {
  const phase = readExecutionItemPhase(previousItem);
  const mergedText = mergeExecutionTurnText(previousItem.summary, currentItem.summary);
  if (!phase || !mergedText) {
    return;
  }

  previousItem.summary = mergedText;
  previousItem.headline = formatExecutionPhaseLabelHeadline(phase, mergedText);
  previousItem.created_at = currentItem.created_at;
  previousItem.linked_target_ids = dedupeIds([
    ...previousItem.linked_target_ids,
    ...currentItem.linked_target_ids,
  ]);
}

function hasMatchingExecutionContext(
  previousItem: WorkflowLiveConsoleItem,
  currentItem: WorkflowLiveConsoleItem,
): boolean {
  return (
    previousItem.source_kind === currentItem.source_kind
    && previousItem.source_label === currentItem.source_label
    && previousItem.scope_binding === currentItem.scope_binding
    && previousItem.work_item_id === currentItem.work_item_id
    && previousItem.task_id === currentItem.task_id
  );
}

function occurredWithinBurstWindow(previousTimestamp: string, currentTimestamp: string): boolean {
  const previousTime = Date.parse(previousTimestamp);
  const currentTime = Date.parse(currentTimestamp);
  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) {
    return false;
  }
  return currentTime >= previousTime && currentTime - previousTime <= EXECUTION_BURST_WINDOW_MS;
}

function mergeExecutionTurnText(previousSummary: string, currentSummary: string): string | null {
  const previousText = normalizeExecutionComparisonText(previousSummary);
  const currentText = normalizeExecutionComparisonText(currentSummary);
  if (!previousText || !currentText || previousText === currentText) {
    return null;
  }

  const mergedText = readOperatorReadableText(`${previousText} ${currentText}`, 180);
  if (!mergedText || mergedText === previousText) {
    return null;
  }
  return mergedText;
}

function normalizeExecutionComparisonText(value: string): string | null {
  return normalizeConsoleText(stripExecutionPhasePrefix(value));
}

function stripExecutionPhasePrefix(value: string): string {
  return value.replace(/^\[[^\]]+\]\s*/, '');
}

function readExecutionItemPhase(item: WorkflowLiveConsoleItem): string | null {
  const match = item.headline.match(/^\[([^\]]+)\]\s+/);
  return match?.[1] ?? null;
}

function formatExecutionPhaseHeadline(operation: string, headline: string): string {
  return `[${readPhaseLabel(operation)}] ${headline}`;
}

function formatExecutionPhaseLabelHeadline(phase: string, headline: string): string {
  return `[${phase}] ${headline}`;
}

function readPhaseLabel(operation: string): string {
  switch (operation) {
    case 'agent.think':
      return 'Think';
    case 'agent.plan':
      return 'Plan';
    case 'agent.act':
      return 'Act';
    case 'agent.observe':
      return 'Observe';
    case 'agent.verify':
      return 'Verify';
    default:
      return humanizeToken(operation);
  }
}

const LOW_VALUE_HELPER_ACTIONS = new Set([
  'artifact_document_read',
  'artifact_list',
  'artifact_read',
  'file_read',
  'file_list',
  'grep',
  'list_work_items',
  'list_workflow_tasks',
  'memory_read',
  'read_predecessor_handoff',
  'read_latest_handoff',
  'read_task_status',
  'read_task_output',
  'read_task_events',
  'read_stage_status',
  'read_work_item_continuity',
]);

const LITERAL_ACTION_FALLBACK_ACTIONS = new Set([
  'shell_exec',
]);

const EXECUTION_BURST_WINDOW_MS = 15_000;

function truncate(value: string | null, maxLength: number): string | null {
  if (!value) {
    return null;
  }
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
