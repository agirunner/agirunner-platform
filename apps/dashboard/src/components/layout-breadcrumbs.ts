export interface LayoutBreadcrumb {
  label: string;
  href?: string;
}

interface BreadcrumbBuildOptions {
  projectLabel?: string;
}

export const PROJECT_BREADCRUMB_STORAGE_PREFIX = 'agirunner.projectLabel.';

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
  '/projects',
  '/projects/memory',
  '/projects/content',
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

function readProjectLabelFromHistoryState(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const historyState = window.history.state as
    | {
        usr?: { projectLabel?: unknown };
        projectLabel?: unknown;
      }
    | null;
  const candidate = historyState?.usr?.projectLabel ?? historyState?.projectLabel;
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
}

function readProjectLabelFromStorage(pathname: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const projectId = extractProjectIdentitySegment(pathname);
  if (!projectId) {
    return null;
  }
  const storageKey = `${PROJECT_BREADCRUMB_STORAGE_PREFIX}${projectId}`;
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

export function rememberProjectBreadcrumbLabel(projectId: string, projectLabel: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  const normalizedProjectId = projectId.trim();
  const normalizedProjectLabel = projectLabel.trim();
  if (!normalizedProjectId || !normalizedProjectLabel) {
    return;
  }
  const storageKey = `${PROJECT_BREADCRUMB_STORAGE_PREFIX}${normalizedProjectId}`;
  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      storage?.setItem(storageKey, normalizedProjectLabel);
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
  const projectLabel =
    options.projectLabel?.trim() || readProjectLabelFromHistoryState() || readProjectLabelFromStorage(pathname);

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const previousSegment = segments[i - 1];
    const normalizedSegment = segment === 'workflows' ? 'boards' : segment;
    currentPath += `/${normalizedSegment}`;
    const isLast = i === segments.length - 1;
    const isProjectIdentitySegment =
      previousSegment === 'projects' && !ROUTABLE_PATHS.has(currentPath);
    const href = !isLast
      ? ROUTABLE_PATHS.has(currentPath)
        ? currentPath
        : isProjectIdentitySegment
          ? `/projects/${segment}`
          : undefined
      : undefined;

    crumbs.push({
      label: isProjectIdentitySegment
        ? projectLabel ?? fallbackProjectLabel(segment)
        : SEGMENT_LABELS[segment] ?? capitalizeSegment(segment),
      ...(href ? { href } : {}),
    });
  }

  return crumbs;
}

function extractProjectIdentitySegment(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'projects' || !segments[1]) {
    return null;
  }
  const normalizedSegment = segments[1] === 'workflows' ? 'boards' : segments[1];
  return ROUTABLE_PATHS.has(`/projects/${normalizedSegment}`) ? null : segments[1];
}

function fallbackProjectLabel(segment: string): string {
  return isUuidLike(segment) ? 'Project' : capitalizeSegment(segment);
}
