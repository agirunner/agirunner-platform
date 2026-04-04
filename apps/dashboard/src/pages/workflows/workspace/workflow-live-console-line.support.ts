import type { DashboardWorkflowLiveConsoleItem } from '../../../lib/api.js';

const ACTION_INVOCATION_RE = /^calling\s+([a-z0-9_.-]+)\((.*)\)$/i;
const EXECUTION_PHASE_PREFIX_RE = /^\[[^\]]+\]\s*/;
const RAW_OPERATOR_RECORD_WRAPPER_RE =
  /^(?:calling\s+)?(?:to=)?record_operator_(?:update|brief)\b/i;
const STRUCTURED_ACTION_ARG_RE =
  /["']?([a-z0-9_.-]+)["']?\s*:\s*(?:"([^"]*)"|'([^']*)'|([^,}\]]+))/gi;
const SYNTHETIC_SOURCE_PREFIX_RE = /^([^:\n]{1,64}):\s*(.+)$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

const SAFE_STRUCTURED_ACTION_ARG_KEYS = new Set([
  'command',
  'completion',
  'decision',
  'feedback',
  'headline',
  'instructions',
  'logical_path',
  'path',
  'role',
  'stage_name',
  'status',
  'summary',
  'title',
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

  return normalizeWorkflowBriefTerminology(normalized.replace(/\s+/g, ' ').trim());
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
  const normalized = stripSyntheticSourcePrefix(
    stripExecutionPhasePrefix(normalizeWorkflowConsoleText(value)),
  );
  if (
    normalized.length === 0
    || looksLikeLowValueConsoleText(normalized)
    || looksLikeRawOperatorRecordWrapper(normalized)
    || looksLikeBareStructuredPayload(normalized)
  ) {
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
  const args = splitActionArgs(rawArgs)
    .flatMap(formatActionArgument)
    .slice(0, 3);
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

function formatActionArgument(argument: string): string[] {
  const [rawKey, ...valueParts] = argument.split('=');
  if (valueParts.length === 0) {
    return isMeaningfulActionValue(argument) ? [sanitizeStandaloneActionValue(argument.trim())] : [];
  }

  const key = rawKey.trim();
  const normalizedKey = key.toLowerCase();
  const value = valueParts.join('=').trim();
  if (MEANINGLESS_ACTION_ARG_KEYS.has(normalizedKey)) {
    return [];
  }

  const structuredArgs = formatStructuredActionArguments(value);
  if (structuredArgs.length > 0) {
    return structuredArgs;
  }
  if (!isMeaningfulActionValue(value)) {
    return [];
  }

  const sanitizedValue = sanitizeActionArgumentValue(normalizedKey, value);
  if (!sanitizedValue || !isMeaningfulActionValue(sanitizedValue)) {
    return [];
  }

  return [`${key}=${quotePreservingActionValue(sanitizedValue)}`];
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

function stripSyntheticSourcePrefix(value: string): string {
  const match = SYNTHETIC_SOURCE_PREFIX_RE.exec(value);
  const remainder = match?.[2]?.trim();
  if (!remainder) {
    return value;
  }
  if (
    remainder.startsWith('calling ')
    || remainder.startsWith('to=')
    || remainder.startsWith('{')
    || remainder.startsWith('[')
  ) {
    return remainder;
  }
  return value;
}

function looksLikeLowValueConsoleText(value: string): boolean {
  return LOW_VALUE_CONSOLE_PATTERNS.some((pattern) => pattern.test(value));
}

function looksLikeRawOperatorRecordWrapper(value: string): boolean {
  return RAW_OPERATOR_RECORD_WRAPPER_RE.test(value);
}

function looksLikeBareStructuredPayload(value: string): boolean {
  const trimmed = value.trim();
  if (!looksLikeStructuredActionValue(trimmed)) {
    return false;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === 'object' && parsed !== null;
  } catch {
    return false;
  }
}

function formatStructuredActionArguments(value: string): string[] {
  const trimmed = value.trim();
  if (!looksLikeStructuredActionValue(trimmed)) {
    return [];
  }

  const renderedArgs: string[] = [];
  const seenArgs = new Set<string>();
  STRUCTURED_ACTION_ARG_RE.lastIndex = 0;
  for (const match of trimmed.matchAll(STRUCTURED_ACTION_ARG_RE)) {
    const rawKey = match[1]?.trim().toLowerCase();
    const rawValue = match[2] ?? match[3] ?? match[4] ?? '';
    if (
      !rawKey
      || !SAFE_STRUCTURED_ACTION_ARG_KEYS.has(rawKey)
      || MEANINGLESS_ACTION_ARG_KEYS.has(rawKey)
    ) {
      continue;
    }

    const normalizedValue = stripWrappingQuotes(rawValue.trim());
    if (!isMeaningfulActionValue(normalizedValue)) {
      continue;
    }

    const renderedArg = `${rawKey}=${quoteActionValue(normalizedValue)}`;
    if (seenArgs.has(renderedArg)) {
      continue;
    }
    seenArgs.add(renderedArg);
    renderedArgs.push(renderedArg);
  }

  return renderedArgs;
}

function looksLikeStructuredActionValue(value: string): boolean {
  return (
    (value.startsWith('{') && value.endsWith('}'))
    || (value.startsWith('[') && value.endsWith(']'))
  );
}

function quoteActionValue(value: string): string {
  if (/^-?\d+(?:\.\d+)?$/.test(value) || /^(?:true|false)$/i.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
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

function sanitizeStandaloneActionValue(value: string): string {
  return quotePreservingActionValue(stripWrappingQuotes(value));
}

function sanitizeActionArgumentValue(key: string, value: string): string | null {
  const unwrapped = stripWrappingQuotes(value);
  if (isPathLikeActionArg(key)) {
    const sanitizedPath = sanitizePathLikeValue(unwrapped);
    return sanitizedPath ? quoteActionValue(sanitizedPath) : null;
  }
  return quotePreservingActionValue(unwrapped);
}

function quotePreservingActionValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed;
  }
  return quoteActionValue(trimmed);
}

function isPathLikeActionArg(key: string): boolean {
  return key === 'path' || key === 'logical_path' || key.endsWith('_path');
}

function sanitizePathLikeValue(value: string): string | null {
  const normalized = value.trim().replace(/\\/g, '/');
  if (normalized.length === 0) {
    return null;
  }
  const logicalContext = describeLogicalContextPath(normalized);
  if (logicalContext) {
    return logicalContext;
  }
  if (normalized.startsWith('/tmp/workspace/')) {
    const relativePath = extractWorkspaceRelativePath(normalized);
    if (!relativePath) {
      return null;
    }
    return describeLogicalContextPath(relativePath) ?? relativePath;
  }
  if (normalized.startsWith('/')) {
    return null;
  }
  if (normalized.startsWith('repo/')) {
    return normalized.slice('repo/'.length);
  }
  return normalized;
}

function extractWorkspaceRelativePath(path: string): string | null {
  const taskScopedMatch = path.match(/^\/tmp\/workspace\/task-[^/]+\/(.+)$/);
  if (taskScopedMatch?.[1]) {
    return normalizeWorkspaceRelativePath(taskScopedMatch[1]);
  }
  const workspaceMatch = path.match(/^\/tmp\/workspace\/(.+)$/);
  if (workspaceMatch?.[1]) {
    return normalizeWorkspaceRelativePath(workspaceMatch[1]);
  }
  return null;
}

function normalizeWorkspaceRelativePath(path: string): string | null {
  if (!path) {
    return null;
  }
  if (path.startsWith('repo/')) {
    return path.slice('repo/'.length);
  }
  if (path.startsWith('workspace/')) {
    return path.slice('workspace/'.length);
  }
  return path;
}

function describeLogicalContextPath(path: string): string | null {
  const filename = path.split('/').at(-1);
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
      return 'predecessor brief';
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

function normalizeWorkflowBriefTerminology(value: string): string {
  return value
    .replace(
      /\bWait for the ((?!structured\b)(?!orchestrator\b)[A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*){0,3}) handoff\b/g,
      'Wait for the $1 brief',
    )
    .replace(
      /\bObserved the active ((?!structured\b)(?!orchestrator\b)[A-Za-z][\w-]*(?:\s+[A-Za-z][\w-]*){0,3}) handoff\b/g,
      'Observed the active $1 brief',
    )
    .replace(/\bwriting the handoff\b/gi, 'writing the brief')
    .replace(/\bwrite the handoff\b/gi, 'write the brief')
    .replace(/\b[Tt]he handoff is blocked\b/g, (match) => (
      match.startsWith('T') ? 'The brief is blocked' : 'the brief is blocked'
    ));
}
