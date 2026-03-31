import {
  readFirstString,
  readOptionalNumber,
  readString,
  truncate,
} from './shared.js';

export function readActionPath(input: Record<string, unknown>): string | null {
  return readFirstString([
    sanitizePathLikeArg(readString(input.logical_path)),
    sanitizePathLikeArg(readString(input.path)),
    sanitizePathLikeArg(readString(input.artifact_name)),
  ]);
}

export function formatPathRangeSummary(input: Record<string, unknown>): string | null {
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

export function sanitizePathLikeArg(value: string | null): string | null {
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
  return path.startsWith('repo/') ? path.slice('repo/'.length) : path;
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
  switch (normalized.split('/').at(-1)) {
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
