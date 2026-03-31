import {
  capitalizeSentence,
  readFirstString,
  readString,
  truncate,
} from './shared.js';
import {
  formatPathRangeSummary,
  readActionPath,
  sanitizePathLikeArg,
} from './action-formatting-paths.js';
import {
  buildHumanizedShellExecHeadline,
  isLowValueShellCommand,
} from './action-formatting-shell.js';
import { readHumanizedString } from './shared.js';
import {
  looksLikeLowValueConsoleText,
  looksLikePlannedActionPlaceholder,
  looksLikeSyntheticActionPreview,
  readOperatorReadableField,
  readOperatorReadableText,
  stripExecutionPhasePrefix,
} from './console-text.js';

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

export function readActionName(payload: Record<string, unknown>): string | null {
  return (
    readString(payload.mcp_tool_name)
    ?? readString(payload.tool)
    ?? readString(payload.action)
    ?? readString(payload.command)
  );
}

export function readActText(
  payload: Record<string, unknown>,
  actionHeadline: string | null,
): string | null {
  const actionName = readActionName(payload);
  const explicitHeadline = readOperatorReadableField(payload, ['headline']);
  if (
    explicitHeadline
    && !looksLikeSyntheticActionPreview(explicitHeadline, actionHeadline, actionName)
    && !looksLikeLowValueConsoleText(stripExecutionPhasePrefix(explicitHeadline))
  ) {
    return explicitHeadline;
  }

  const textPreview = readOperatorReadableField(payload, ['text_preview']);
  if (
    textPreview
    && !looksLikeSyntheticActionPreview(textPreview, actionHeadline, actionName)
    && !looksLikeLowValueConsoleText(stripExecutionPhasePrefix(textPreview))
  ) {
    return textPreview;
  }
  return null;
}

export function readActSummary(payload: Record<string, unknown>): string | null {
  const humanizedActionHeadline = buildHumanizedActionHeadline(payload);
  const actionHeadline = humanizedActionHeadline ?? buildActionInvocationHeadline(payload);
  return readActText(payload, actionHeadline) ?? humanizedActionHeadline ?? actionHeadline;
}

export function buildActionHeadline(payload: Record<string, unknown>): string | null {
  return buildHumanizedActionHeadline(payload) ?? buildActionInvocationHeadline(payload);
}

export function buildActionInvocationHeadline(payload: Record<string, unknown>): string | null {
  const actionName = readActionName(payload);
  const input = payloadToInput(payload);
  if (!actionName || !canRenderLiteralActionFallback(actionName) || shouldSuppressActionInvocation(actionName, input)) {
    return null;
  }
  const args = summarizeActionArgs(actionName, input);
  return args.length > 0 ? `calling ${actionName}(${args.join(', ')})` : null;
}

export function shouldSuppressActionInvocation(
  actionName: string | null,
  input: Record<string, unknown>,
): boolean {
  return actionName === 'shell_exec' && isLowValueShellCommand(readString(input.command));
}

export function isToolSpecificFallbackOnlyAction(actionName: string): boolean {
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

export function isLowValueHelperAction(actionName: string | null): boolean {
  return actionName !== null && LOW_VALUE_HELPER_ACTIONS.has(actionName);
}

export function isSuppressedActionName(value: string | null): boolean {
  return value === 'record_operator_update' || value === 'record_operator_brief';
}

export function buildHumanizedActionHeadline(payload: Record<string, unknown>): string | null {
  const actionName = readActionName(payload);
  const input = payloadToInput(payload);
  switch (actionName) {
    case 'submit_handoff': {
      const summary = readOperatorReadableText(readString(input.summary), 140);
      return summary ? `Submitting the brief: ${capitalizeSentence(summary)}` : null;
    }
    case 'request_rework': {
      const feedback = readOperatorReadableText(
        readString(input.feedback) ?? readString(input.summary),
        140,
      );
      return feedback ? `Requesting rework: ${capitalizeSentence(feedback)}` : 'Requesting rework.';
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
    case 'shell_exec':
      return buildHumanizedShellExecHeadline(readString(input.command));
    default:
      return null;
  }
}

export function readPlanText(payload: Record<string, unknown>): string | null {
  const explicitPlanText = readOperatorReadableField(payload, ['headline', 'summary', 'plan_summary']);
  if (explicitPlanText && !looksLikePlannedActionPlaceholder(explicitPlanText)) {
    return explicitPlanText;
  }
  const plannedActionSummary = buildPlannedActionSummary(payload.steps);
  if (plannedActionSummary) {
    return plannedActionSummary;
  }
  return readOperatorReadableText(readFirstMeaningfulPlanDescription(payload.steps), 180);
}

export function joinActionHeadlines(headlines: string[]): string {
  if (headlines.length === 1) {
    return headlines[0]!;
  }
  return headlines
    .map((headline, index) => normalizeJoinedActionHeadline(headline, index === 0, index === headlines.length - 1))
    .join('; ');
}

function payloadToInput(payload: Record<string, unknown>): Record<string, unknown> {
  const value = payload.input;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function canRenderLiteralActionFallback(actionName: string): boolean {
  if (LITERAL_ACTION_FALLBACK_ACTIONS.has(actionName)) {
    return true;
  }
  if (isToolSpecificFallbackOnlyAction(actionName) || isLowValueHelperAction(actionName)) {
    return true;
  }
  return /^(create|submit|update|write|edit|delete|approve|reject|reassign|assign|claim|start|complete|finish|close|open|upload|request|dispatch|resume|pause|retry|reroute|set|mark)_/i.test(
    actionName,
  );
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
    return normalized ? `${key}="${normalized}"` : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return `${key}=${String(value)}`;
  }
  return null;
}

function shouldSkipActionArg(key: string, value: unknown): boolean {
  if (!key.trim() || key === 'cwd') {
    return true;
  }
  if (/(^|_)(id|ids)$/.test(key) || key.endsWith('_id') || key === 'request_id') {
    return true;
  }
  return Array.isArray(value) || (value !== null && typeof value === 'object');
}

function normalizeActionArgText(key: string, value: string): string | null {
  const sanitizedPath = isPathLikeKey(key) ? sanitizePathLikeArg(value) : null;
  const normalized = readOperatorReadableText(sanitizedPath ?? value, 72);
  return normalized ? normalized.replace(/"/g, "'") : null;
}

function buildPlannedActionSummary(stepsValue: unknown): string | null {
  if (!Array.isArray(stepsValue)) {
    return null;
  }
  for (const entry of stepsValue) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const step = entry as Record<string, unknown>;
    const tool = readString(step.tool);
    if (!tool) {
      continue;
    }
    const input = payloadToInput(step);
    if (shouldSuppressActionInvocation(tool, input)) {
      continue;
    }
    const actionSummary = buildActionHeadline({ tool, input }) ?? buildActionInvocationHeadline({ tool, input });
    if (actionSummary) {
      return actionSummary;
    }
  }
  return null;
}

function readFirstMeaningfulPlanDescription(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const tool = readString(record.tool);
    if (tool && (isToolSpecificFallbackOnlyAction(tool) || isLowValueHelperAction(tool))) {
      continue;
    }
    const description = readString(record.description);
    if (!description || looksLikePlannedActionPlaceholder(description)) {
      continue;
    }
    return description;
  }
  return null;
}

function isPathLikeKey(key: string): boolean {
  return key === 'path' || key === 'logical_path' || key.endsWith('_path');
}

function normalizeJoinedActionHeadline(
  headline: string,
  isFirst: boolean,
  isLast: boolean,
): string {
  const trimmed = headline.trim();
  const withoutTrailingPunctuation = trimmed.replace(/[.!?]+$/g, '');
  const normalized = isLast ? withoutTrailingPunctuation : withoutTrailingPunctuation;
  if (isFirst) {
    return isLast ? `${normalized}.` : normalized;
  }
  const lowered =
    normalized.length === 0 ? normalized : normalized[0]!.toLowerCase() + normalized.slice(1);
  return isLast ? `${lowered}.` : lowered;
}
