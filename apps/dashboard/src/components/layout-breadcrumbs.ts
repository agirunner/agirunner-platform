export interface LayoutBreadcrumb {
  label: string;
  href?: string;
}

interface BreadcrumbBuildOptions {
  workspaceLabel?: string;
}

export const WORKSPACE_BREADCRUMB_STORAGE_PREFIX = 'agirunner.workspaceLabel.';

const SEGMENT_LABELS: Record<string, string> = {
  boards: 'Workflow Boards',
  workflows: 'Workflow Boards',
  users: 'Legacy User Access',
  memory: 'Memory',
  content: 'Documents',
  artifacts: 'Artifacts',
};

/**
 * Set of static paths that resolve to real dashboard pages.
 *
 * Only segments whose accumulated path appears here receive a clickable href in
 * the breadcrumb bar.  Paths like `/work` or `/config` that serve as grouping
 * prefixes but have no dedicated page are intentionally omitted.
 */
const ROUTABLE_PATHS: ReadonlySet<string> = new Set([
  '/mission-control',
  '/mission-control/alerts',
  '/mission-control/costs',
  '/logs',
  '/work/boards',
  '/work/tasks',
  '/work/approvals',
  '/workspaces',
  '/workspaces/memory',
  '/workspaces/content',
  '/config/playbooks',
  '/config/roles',
  '/config/llm',
  '/config/runtimes',
  '/config/integrations',
  '/config/instructions',
  '/config/tools',
  '/config/webhooks',
  '/config/triggers',
  '/config/assistant',
  '/fleet/workers',
  '/fleet/agents',
  '/fleet/docker',
  '/fleet/warm-pools',
  '/fleet/status',
  '/governance/settings',
  '/governance/api-keys',
  '/governance/users',
  '/governance/retention',
  '/governance/grants',
]);

function capitalizeSegment(segment: string): string {
  return segment.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function isUuidLike(segment: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(segment);
}

function readWorkspaceLabelFromHistoryState(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const historyState = window.history.state as
    | {
        usr?: { workspaceLabel?: unknown };
        workspaceLabel?: unknown;
      }
    | null;
  const candidate = historyState?.usr?.workspaceLabel ?? historyState?.workspaceLabel;
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
}

function readWorkspaceLabelFromStorage(pathname: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const workspaceId = extractWorkspaceIdentitySegment(pathname);
  if (!workspaceId) {
    return null;
  }
  const storageKey = `${WORKSPACE_BREADCRUMB_STORAGE_PREFIX}${workspaceId}`;
  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      const candidate = storage?.getItem(storageKey);
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function rememberWorkspaceBreadcrumbLabel(workspaceId: string, workspaceLabel: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  const normalizedWorkspaceId = workspaceId.trim();
  const normalizedWorkspaceLabel = workspaceLabel.trim();
  if (!normalizedWorkspaceId || !normalizedWorkspaceLabel) {
    return;
  }
  const storageKey = `${WORKSPACE_BREADCRUMB_STORAGE_PREFIX}${normalizedWorkspaceId}`;
  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      storage?.setItem(storageKey, normalizedWorkspaceLabel);
    } catch {
      continue;
    }
  }
}

export function buildBreadcrumbs(pathname: string, options: BreadcrumbBuildOptions = {}): LayoutBreadcrumb[] {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return [{ label: 'Home' }];

  const crumbs: LayoutBreadcrumb[] = [];
  let currentPath = '';
  const workspaceLabel =
    options.workspaceLabel?.trim() || readWorkspaceLabelFromHistoryState() || readWorkspaceLabelFromStorage(pathname);

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const previousSegment = segments[i - 1];
    const normalizedSegment = segment === 'workflows' ? 'boards' : segment;
    currentPath += `/${normalizedSegment}`;
    const isLast = i === segments.length - 1;
    const isWorkspaceIdentitySegment =
      previousSegment === 'workspaces' && !ROUTABLE_PATHS.has(currentPath);
    const href = !isLast
      ? ROUTABLE_PATHS.has(currentPath)
        ? currentPath
        : isWorkspaceIdentitySegment
          ? `/workspaces/${segment}`
          : undefined
      : undefined;

    crumbs.push({
      label: isWorkspaceIdentitySegment
        ? workspaceLabel ?? fallbackWorkspaceLabel(segment)
        : SEGMENT_LABELS[segment] ?? capitalizeSegment(segment),
      ...(href ? { href } : {}),
    });
  }

  return crumbs;
}

function extractWorkspaceIdentitySegment(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'workspaces' || !segments[1]) {
    return null;
  }
  const normalizedSegment = segments[1] === 'workflows' ? 'boards' : segments[1];
  return ROUTABLE_PATHS.has(`/workspaces/${normalizedSegment}`) ? null : segments[1];
}

function fallbackWorkspaceLabel(segment: string): string {
  return isUuidLike(segment) ? 'Workspace' : capitalizeSegment(segment);
}
