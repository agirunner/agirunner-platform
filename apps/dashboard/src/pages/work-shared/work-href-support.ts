import {
  buildWorkflowsPageHref,
  readWorkflowsPageState,
} from '../workflows/workflows-page.support.js';
import { buildWorkflowDetailPermalink } from '../../app/routes/workflow-navigation.js';

export function buildTaskDetailHref(taskId: string): string {
  return `/work/tasks/${encodeURIComponent(taskId.trim())}`;
}

export function normalizeWorkflowBoardHref(input: {
  href?: string | null;
  workflowId?: string | null;
}): string | null {
  const workflowId = input.workflowId?.trim();
  if (workflowId) {
    return buildWorkflowDetailPermalink(workflowId, {});
  }

  const href = input.href?.trim() ?? '';
  if (href.length === 0) {
    return null;
  }
  if (href.startsWith('/workflows')) {
    return normalizeCanonicalWorkflowHref(href);
  }

  const derivedWorkflowId = readWorkflowIdFromHref(href);
  if (derivedWorkflowId) {
    return buildWorkflowDetailPermalink(derivedWorkflowId, {});
  }

  return href;
}

function readWorkflowIdFromHref(href: string): string | null {
  const pathname = href.split(/[?#]/, 1)[0] ?? '';
  const segments = pathname.split('/').filter(Boolean);
  const workflowsIndex = segments.lastIndexOf('workflows');
  if (workflowsIndex === -1 || !segments[workflowsIndex + 1]) {
    return null;
  }
  return decodeURIComponent(segments[workflowsIndex + 1]);
}

function normalizeCanonicalWorkflowHref(href: string): string {
  const [pathAndSearch, hashFragment = ''] = href.split('#', 2);
  const [pathname, rawSearch = ''] = pathAndSearch.split('?', 2);
  const state = readWorkflowsPageState(pathname, new URLSearchParams(rawSearch));
  const canonicalHref = buildWorkflowsPageHref({}, state);
  return hashFragment.length > 0 ? `${canonicalHref}#${hashFragment}` : canonicalHref;
}
