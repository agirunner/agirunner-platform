import type { DashboardWorkflowWorkspacePacket } from '../../../../lib/api.js';
import type { WorkflowWorkbenchScopeDescriptor } from '../../workflows-page.support.js';

export function resolveWorkbenchScope(props: {
  packet: DashboardWorkflowWorkspacePacket;
  workflowName: string;
  selectedWorkItemTitle: string | null;
  scope: WorkflowWorkbenchScopeDescriptor;
}): WorkflowWorkbenchScopeDescriptor {
  const scopeKind = props.packet.bottom_tabs.current_scope_kind;
  const workItemId =
    props.packet.bottom_tabs.current_work_item_id ??
    props.packet.selected_scope.work_item_id;

  if (
    scopeKind !== 'workflow' &&
    (props.selectedWorkItemTitle ?? workItemId ?? props.scope.name)
  ) {
    const workItemName = props.selectedWorkItemTitle ?? workItemId ?? props.scope.name;
    return {
      scopeKind: 'selected_work_item',
      title: 'Work item',
      subject: 'work item',
      name: workItemName,
      banner: `Work item · ${workItemName}`,
    };
  }

  return {
    scopeKind: 'workflow',
    title: 'Workflow',
    subject: 'workflow',
    name: props.workflowName,
    banner: 'Workflow',
  };
}
