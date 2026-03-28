import { buildWorkflowDetailPermalink } from '../workflow-detail/workflow-detail-permalinks.js';

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
    return href;
  }

  const match = href.match(/^\/mission-control\/workflows\/([^/?#]+)/);
  if (match?.[1]) {
    return buildWorkflowDetailPermalink(decodeURIComponent(match[1]), {});
  }

  return href;
}
