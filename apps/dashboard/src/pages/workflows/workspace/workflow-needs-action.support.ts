import type {
  DashboardWorkflowNeedsActionDetail,
  DashboardWorkflowNeedsActionItem,
  DashboardWorkflowNeedsActionResponseAction,
} from '../../../lib/api.js';
import { dashboardApi } from '../../../lib/api.js';

export interface WorkflowNeedsActionWorkflowTaskContext {
  workItemId: string;
  taskId: string;
}

export function resolveNeedsActionWorkflowTaskContext(input: {
  item: Pick<DashboardWorkflowNeedsActionItem, 'target'>;
  action: Pick<DashboardWorkflowNeedsActionResponseAction, 'kind' | 'target' | 'work_item_id'>;
}): WorkflowNeedsActionWorkflowTaskContext {
  const taskId = input.action.target.target_id.trim();
  const explicitWorkItemId = input.action.work_item_id?.trim();

  if (explicitWorkItemId) {
    return {
      workItemId: explicitWorkItemId,
      taskId,
    };
  }

  if (input.item.target.target_kind === 'work_item') {
    return {
      workItemId: input.item.target.target_id,
      taskId,
    };
  }

  throw new Error('Workflow task action is missing work-item context.');
}

export function buildNeedsActionDossier(
  item: DashboardWorkflowNeedsActionItem,
  visibleTargetKind: DashboardWorkflowNeedsActionItem['target']['target_kind'],
): {
  needsDecision: string;
  whyItNeedsAction: string;
  blockingNow: string;
  workSoFar: string;
  recommendedAction: string;
  evidence: string | null;
  additionalDetails: Array<{ label: string; value: string }>;
} {
  const consumedLabels = new Set<string>([
    'approval_target',
    'requested_decision',
    'decision',
    'escalation',
    'blocking_state',
    'blocked_state',
    'blocking_reason',
    'context',
    'work_so_far',
    'progress',
    'status',
    'recommendation',
    'recommended_action',
    'next_action',
    'verification',
    'evidence',
    'output',
    'deliverable',
    'artifacts',
  ]);

  return {
    needsDecision:
      readDetailValue(item.details, [
        'approval_target',
        'requested_decision',
        'decision',
        'escalation',
      ]) ?? `${item.label} for this ${humanizeToken(visibleTargetKind).toLowerCase()}.`,
    whyItNeedsAction:
      readSentence(item.summary) ?? 'This packet is waiting on an operator decision.',
    blockingNow:
      readDetailValue(item.details, [
        'blocking_state',
        'blocked_state',
        'blocking_reason',
        'context',
      ]) ??
      `Progress is paused until an operator responds to this ${humanizeToken(
        visibleTargetKind,
      ).toLowerCase()} packet.`,
    workSoFar:
      readDetailValue(item.details, ['work_so_far', 'progress', 'status', 'context']) ??
      'No additional work summary was attached to this packet yet.',
    recommendedAction:
      readDetailValue(item.details, [
        'recommendation',
        'recommended_action',
        'next_action',
      ]) ??
      item.responses.find(isVisibleNeedsActionResponse)?.label ??
      'Review the packet and choose the next legal operator action.',
    evidence: readCombinedDetailValues(item.details, [
      'verification',
      'evidence',
      'output',
      'deliverable',
      'artifacts',
    ]),
    additionalDetails: readAdditionalDetailRows(item.details, consumedLabels),
  };
}

export function buildNeedsActionScopeLine(
  visibleScopeSubject: 'workflow' | 'work item',
  scopeLabel: string,
  item: DashboardWorkflowNeedsActionItem,
): string | null {
  if (visibleScopeSubject === 'work item') {
    return scopeLabel.replace(/^Work item:\s*/i, 'Work item · ');
  }
  if (item.target.target_kind === 'workflow') {
    return 'Workflow';
  }
  if (item.work_item_id) {
    return `Work item · ${item.work_item_id}`;
  }
  return null;
}

export function normalizeNeedsActionScope(
  scopeSubject: 'workflow' | 'work item' | 'task' | undefined,
  scopeLabel: string | undefined,
): { subject: 'workflow' | 'work item'; label: string } {
  if (scopeSubject === 'task') {
    return {
      subject: 'work item',
      label: scopeLabel?.startsWith('Work item:') ? scopeLabel : 'This work item',
    };
  }
  const subject = scopeSubject ?? 'workflow';
  return {
    subject,
    label: scopeLabel ?? `This ${subject}`,
  };
}

export function describeNeedsActionVisibleTargetKind(
  visibleScopeSubject: 'workflow' | 'work item',
  actionTargetKind: DashboardWorkflowNeedsActionItem['target']['target_kind'],
): DashboardWorkflowNeedsActionItem['target']['target_kind'] {
  if (visibleScopeSubject === 'work item' && actionTargetKind === 'task') {
    return 'work_item';
  }
  return actionTargetKind;
}

export async function runNeedsAction(
  workflowId: string,
  item: DashboardWorkflowNeedsActionItem,
  action: DashboardWorkflowNeedsActionResponseAction,
  promptValue: string,
): Promise<void> {
  switch (action.kind) {
    case 'approve_task': {
      const workflowTaskContext = resolveNeedsActionWorkflowTaskContext({ item, action });
      await dashboardApi.approveWorkflowWorkItemTask(
        workflowId,
        workflowTaskContext.workItemId,
        workflowTaskContext.taskId,
      );
      return;
    }
    case 'approve_task_output': {
      const workflowTaskContext = resolveNeedsActionWorkflowTaskContext({ item, action });
      await dashboardApi.approveWorkflowWorkItemTaskOutput(
        workflowId,
        workflowTaskContext.workItemId,
        workflowTaskContext.taskId,
      );
      return;
    }
    case 'reject_task': {
      const workflowTaskContext = resolveNeedsActionWorkflowTaskContext({ item, action });
      await dashboardApi.rejectWorkflowWorkItemTask(
        workflowId,
        workflowTaskContext.workItemId,
        workflowTaskContext.taskId,
        { feedback: promptValue.trim() },
      );
      return;
    }
    case 'request_changes_task': {
      const workflowTaskContext = resolveNeedsActionWorkflowTaskContext({ item, action });
      await dashboardApi.requestWorkflowWorkItemTaskChanges(
        workflowId,
        workflowTaskContext.workItemId,
        workflowTaskContext.taskId,
        { feedback: promptValue.trim() },
      );
      return;
    }
    case 'resolve_escalation': {
      const workflowTaskContext = resolveNeedsActionWorkflowTaskContext({ item, action });
      await dashboardApi.resolveWorkflowWorkItemTaskEscalation(
        workflowId,
        workflowTaskContext.workItemId,
        workflowTaskContext.taskId,
        { instructions: promptValue.trim() },
      );
      return;
    }
    case 'approve_gate':
      await dashboardApi.actOnWorkflowGate(workflowId, action.target.target_id, {
        action: 'approve',
      });
      return;
    case 'reject_gate':
      await dashboardApi.actOnWorkflowGate(workflowId, action.target.target_id, {
        action: 'reject',
        feedback: promptValue.trim(),
      });
      return;
    case 'request_changes_gate':
      await dashboardApi.actOnWorkflowGate(workflowId, action.target.target_id, {
        action: 'request_changes',
        feedback: promptValue.trim(),
      });
      return;
    case 'retry_task': {
      const workflowTaskContext = resolveNeedsActionWorkflowTaskContext({ item, action });
      await dashboardApi.retryWorkflowWorkItemTask(
        workflowId,
        workflowTaskContext.workItemId,
        workflowTaskContext.taskId,
      );
      return;
    }
    case 'redrive_workflow':
      await dashboardApi.redriveWorkflow(workflowId, { request_id: crypto.randomUUID() });
      return;
    default:
      throw new Error(`Unsupported needs-action response '${action.kind}'.`);
  }
}

export function isVisibleNeedsActionResponse(
  action: DashboardWorkflowNeedsActionResponseAction,
): boolean {
  return (
    action.kind === 'approve_task' ||
    action.kind === 'approve_task_output' ||
    action.kind === 'approve_gate' ||
    action.kind === 'reject_task' ||
    action.kind === 'reject_gate' ||
    action.kind === 'request_changes_task' ||
    action.kind === 'request_changes_gate' ||
    action.kind === 'resolve_escalation'
  );
}

export function shouldDisplayNeedsActionItem(item: DashboardWorkflowNeedsActionItem): boolean {
  return item.responses.some(isVisibleNeedsActionResponse);
}

export function readSuccessMessage(actionKind: string): string {
  switch (actionKind) {
    case 'approve_task':
      return 'Approval recorded';
    case 'approve_task_output':
      return 'Output approval recorded';
    case 'reject_task':
      return 'Rejection recorded';
    case 'approve_gate':
      return 'Approval recorded';
    case 'reject_gate':
      return 'Rejection recorded';
    case 'request_changes_task':
      return 'Change request recorded';
    case 'request_changes_gate':
      return 'Change request recorded';
    case 'resolve_escalation':
      return 'Escalation resolved';
    default:
      return 'Operator action applied';
  }
}

export function readScopedAwayWorkflowMessage(scopedAwayWorkflowCount: number): string {
  if (scopedAwayWorkflowCount === 1) {
    return '1 workflow-level action remains available in workflow scope.';
  }
  return `${scopedAwayWorkflowCount} workflow-level actions remain available in workflow scope.`;
}

export function buildPromptMeta(
  action: DashboardWorkflowNeedsActionResponseAction | null,
): {
  title: string;
  description: string;
  placeholder: string;
  confirmLabel: string;
  requiredMessage: string;
} {
  if (!action) {
    return {
      title: 'Operator response',
      description: '',
      placeholder: '',
      confirmLabel: 'Apply',
      requiredMessage: 'Enter a response before continuing.',
    };
  }
  if (action.prompt_kind === 'instructions') {
    return {
      title: 'Resume with guidance',
      description:
        'Provide the concrete operator guidance that should unblock this escalated task.',
      placeholder:
        'Describe the guidance the specialist or orchestrator should follow next...',
      confirmLabel: 'Resume task',
      requiredMessage: 'Enter operator guidance before continuing.',
    };
  }
  return {
    title:
      action.kind === 'reject_task' || action.kind === 'reject_gate'
        ? 'Reject approval'
        : 'Request changes',
    description:
      action.kind === 'reject_gate' || action.kind === 'request_changes_gate'
        ? 'Attach explicit operator feedback to this approval gate so the next workflow step is clear.'
        : 'Attach explicit operator feedback to this task so the next workflow step is clear.',
    placeholder: 'Describe the changes or rejection reason...',
    confirmLabel:
      action.kind === 'reject_task' || action.kind === 'reject_gate'
        ? 'Reject'
        : 'Request changes',
    requiredMessage: 'Enter review feedback before continuing.',
  };
}

function readDetailValue(
  details: DashboardWorkflowNeedsActionDetail[] | undefined,
  labels: string[],
): string | null {
  if (!details) {
    return null;
  }

  for (const detail of details) {
    if (labels.includes(normalizeDetailLabel(detail.label))) {
      return readSentence(detail.value) ?? null;
    }
  }

  return null;
}

function readCombinedDetailValues(
  details: DashboardWorkflowNeedsActionDetail[] | undefined,
  labels: string[],
): string | null {
  if (!details) {
    return null;
  }

  const values = details
    .filter((detail) => labels.includes(normalizeDetailLabel(detail.label)))
    .map((detail) => readSentence(detail.value))
    .filter((value): value is string => Boolean(value));

  if (values.length === 0) {
    return null;
  }

  return values.join(' ');
}

function readAdditionalDetailRows(
  details: DashboardWorkflowNeedsActionDetail[] | undefined,
  consumedLabels: Set<string>,
): Array<{ label: string; value: string }> {
  if (!details) {
    return [];
  }

  return details
    .map((detail) => ({
      label: detail.label.trim(),
      normalizedLabel: normalizeDetailLabel(detail.label),
      value: readSentence(detail.value),
    }))
    .filter(
      (
        detail,
      ): detail is { label: string; normalizedLabel: string; value: string } =>
        detail.label.length > 0
        && detail.value !== null
        && !consumedLabels.has(detail.normalizedLabel),
    )
    .map((detail) => ({
      label: detail.label,
      value: detail.value,
    }));
}

function normalizeDetailLabel(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

function readSentence(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function humanizeToken(value: string | null | undefined): string {
  if (!value) {
    return 'Workflow';
  }
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
