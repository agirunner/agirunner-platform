export interface WorkflowDetailTarget {
  workItemId?: string | null;
  activationId?: string | null;
  childWorkflowId?: string | null;
  gateStageName?: string | null;
}

export function buildWorkflowDetailPermalink(
  workflowId: string,
  target: WorkflowDetailTarget,
): string {
  const params = new URLSearchParams();

  if (target.workItemId) {
    params.set('work_item', target.workItemId);
  }
  if (target.activationId) {
    params.set('activation', target.activationId);
  }
  if (target.childWorkflowId) {
    params.set('child', target.childWorkflowId);
  }
  if (target.gateStageName) {
    params.set('gate', target.gateStageName);
  }

  const query = params.toString();
  const hash = buildWorkflowDetailHash(target);
  return `/work/workflows/${workflowId}${query ? `?${query}` : ''}${hash}`;
}

export function buildWorkflowDetailHash(target: WorkflowDetailTarget): string {
  if (target.workItemId) {
    return `#work-item-${encodeURIComponent(target.workItemId)}`;
  }
  if (target.activationId) {
    return `#activation-${encodeURIComponent(target.activationId)}`;
  }
  if (target.childWorkflowId) {
    return `#child-workflow-${encodeURIComponent(target.childWorkflowId)}`;
  }
  if (target.gateStageName) {
    return `#gate-${encodeURIComponent(target.gateStageName)}`;
  }
  return '';
}

export function isWorkflowDetailTargetHighlighted(
  search: string,
  hash: string,
  key: 'work_item' | 'activation' | 'child' | 'gate',
  value: string,
): boolean {
  const params = new URLSearchParams(search);
  if (params.get(key) === value) {
    return true;
  }
  const expectedHash =
    key === 'work_item'
      ? `#work-item-${value}`
      : key === 'activation'
        ? `#activation-${value}`
        : key === 'child'
          ? `#child-workflow-${value}`
          : `#gate-${value}`;
  return hash === expectedHash;
}
