export interface LayoutBreadcrumb {
  label: string;
  href?: string;
}

const SEGMENT_LABELS: Record<string, string> = {
  boards: 'Workflow Boards',
  workflows: 'Workflow Boards',
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

export function buildBreadcrumbs(pathname: string): LayoutBreadcrumb[] {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return [{ label: 'Home' }];

  const crumbs: LayoutBreadcrumb[] = [];
  let currentPath = '';

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const normalizedSegment = segment === 'workflows' ? 'boards' : segment;
    currentPath += `/${normalizedSegment}`;
    const isLast = i === segments.length - 1;

    crumbs.push({
      label: SEGMENT_LABELS[segment] ?? capitalizeSegment(segment),
      ...(!isLast && ROUTABLE_PATHS.has(currentPath) ? { href: currentPath } : {}),
    });
  }

  return crumbs;
}
