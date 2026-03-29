import type { DashboardWorkflowLiveConsoleItem } from '../../../lib/api.js';

const ACTION_INVOCATION_RE = /^calling\s+([a-z0-9_.-]+)\((.*)\)$/i;
const EXECUTION_PHASE_PREFIX_RE = /^\[[^\]]+\]\s*/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SUPPRESSED_READ_ONLY_ACTION_TOOLS = new Set([
  'artifact_document_read',
  'artifact_list',
  'artifact_read',
  'file_list',
  'file_read',
  'grep',
  'list_work_items',
  'list_workflow_tasks',
  'memory_read',
  'read_latest_handoff',
  'read_predecessor_handoff',
  'read_stage_status',
  'read_task_events',
  'read_task_output',
  'read_task_status',
  'read_work_item_continuity',
]);

const TOOL_SPECIFIC_FALLBACK_ONLY_ACTIONS = new Set([
  'artifact_document_read',
  'artifact_read',
  'artifact_upload',
  'file_edit',
  'file_list',
  'file_read',
  'file_write',
]);

const MEANINGLESS_ACTION_ARG_KEYS = new Set([
  'activation_id',
  'event_id',
  'latest_event_id',
  'request_id',
  'run_id',
  'session_id',
  'snapshot_version',
  'task_id',
  'turn_id',
  'work_item_id',
  'workflow_id',
]);

const LOW_VALUE_CONSOLE_PATTERNS = [
  /^advancing the task with the next verified step\.?$/i,
  /^checking current progress\.?$/i,
  /^tool execution in progress$/i,
  /^working through the next execution step\.?$/i,
  /^working through the next step for task\.?$/i,
];

export function normalizeWorkflowConsoleText(value: string): string {
  let normalized = value
    .replace(/\u200b|\u200c|\u200d|\u2060|\ufeff/g, ' ')
    .replace(/\ufffd/g, ' ')
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

  return normalized.replace(/\s+/g, ' ').trim();
}

export function getWorkflowConsoleLineText(item: DashboardWorkflowLiveConsoleItem): string {
  const candidates = [item.headline, item.summary];
  for (const candidate of candidates) {
    const formatted = formatWorkflowConsoleLineText(candidate);
    if (formatted.length > 0) {
      return formatted;
    }
  }
  return '';
}

export function hasWorkflowConsoleLineText(item: DashboardWorkflowLiveConsoleItem): boolean {
  return getWorkflowConsoleLineText(item).length > 0;
}

function formatWorkflowConsoleLineText(value: string): string {
  const normalized = stripExecutionPhasePrefix(normalizeWorkflowConsoleText(value));
  if (normalized.length === 0 || looksLikeLowValueConsoleText(normalized)) {
    return '';
  }

  const actionInvocation = readActionInvocation(normalized);
  if (!actionInvocation) {
    return normalized;
  }

  return formatActionInvocation(actionInvocation.actionName, actionInvocation.rawArgs);
}

function readActionInvocation(value: string): { actionName: string; rawArgs: string } | null {
  const match = ACTION_INVOCATION_RE.exec(value);
  if (!match) {
    return null;
  }

  const actionName = match[1]?.trim().toLowerCase();
  const rawArgs = match[2] ?? '';
  if (!actionName) {
    return null;
  }

  return { actionName, rawArgs };
}

function formatActionInvocation(actionName: string, rawArgs: string): string {
  if (
    SUPPRESSED_READ_ONLY_ACTION_TOOLS.has(actionName)
    || TOOL_SPECIFIC_FALLBACK_ONLY_ACTIONS.has(actionName)
  ) {
    return '';
  }

  const args = splitActionArgs(rawArgs).filter(isMeaningfulActionArgument);
  if (args.length === 0) {
    return '';
  }

  return `calling ${actionName}(${args.join(', ')})`;
}

function splitActionArgs(rawArgs: string): string[] {
  const normalized = rawArgs.trim();
  if (normalized.length === 0) {
    return [];
  }

  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let depth = 0;

  for (const character of normalized) {
    if (quote) {
      current += character;
      if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }

    if (character === '(' || character === '[' || character === '{') {
      depth += 1;
      current += character;
      continue;
    }

    if (character === ')' || character === ']' || character === '}') {
      depth = Math.max(0, depth - 1);
      current += character;
      continue;
    }

    if (character === ',' && depth === 0) {
      pushActionArg(args, current);
      current = '';
      continue;
    }

    current += character;
  }

  pushActionArg(args, current);
  return args;
}

function pushActionArg(args: string[], value: string): void {
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    args.push(trimmed);
  }
}

function isMeaningfulActionArgument(argument: string): boolean {
  const [rawKey, ...valueParts] = argument.split('=');
  if (valueParts.length === 0) {
    return isMeaningfulActionValue(argument);
  }

  const key = rawKey.trim().toLowerCase();
  const value = valueParts.join('=').trim();
  if (MEANINGLESS_ACTION_ARG_KEYS.has(key)) {
    return false;
  }

  return isMeaningfulActionValue(value);
}

function isMeaningfulActionValue(value: string): boolean {
  const trimmed = stripWrappingQuotes(value.trim());
  if (trimmed.length === 0) {
    return false;
  }
  if (trimmed === '{}' || trimmed === '[]') {
    return false;
  }
  if (/^(?:none|null|undefined)$/i.test(trimmed)) {
    return false;
  }
  if (UUID_RE.test(trimmed)) {
    return false;
  }
  return true;
}

function stripExecutionPhasePrefix(value: string): string {
  return value.replace(EXECUTION_PHASE_PREFIX_RE, '').trim();
}

function looksLikeLowValueConsoleText(value: string): boolean {
  return LOW_VALUE_CONSOLE_PATTERNS.some((pattern) => pattern.test(value));
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}
