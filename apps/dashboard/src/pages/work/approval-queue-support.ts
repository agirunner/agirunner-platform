import type {
  DashboardApprovalStageGateRecord,
  DashboardApprovalTaskRecord,
} from '../../lib/api.js';
import { readWorkflowOperatorFlowLabel } from './task-operator-flow.js';
import {
  buildGateBreadcrumbs,
  readGateDecisionSummary,
  readGateRequestSourceSummary,
  readGateResumptionSummary,
} from './gate-detail-support.js';

export function computeWaitingTime(createdAt: string): string {
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function truncateOutput(output: unknown): string {
  if (output === undefined || output === null) return '';
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  if (text.length <= 200) return text;
  return `${text.slice(0, 200)}...`;
}

export function summarizeOldestWaiting(
  stageGates: DashboardApprovalStageGateRecord[],
  taskApprovals: DashboardApprovalTaskRecord[],
): string {
  const timestamps = [
    ...stageGates.map((gate) => gate.updated_at),
    ...taskApprovals.map((task) => task.created_at),
  ];
  if (timestamps.length === 0) {
    return 'No approvals pending';
  }
  const oldest = timestamps.reduce((currentOldest, timestamp) =>
    new Date(timestamp).getTime() < new Date(currentOldest).getTime() ? timestamp : currentOldest,
  );
  return `Oldest waiting ${computeWaitingTime(oldest)}`;
}

export function sortStageGates(
  stageGates: DashboardApprovalStageGateRecord[],
): DashboardApprovalStageGateRecord[] {
  return [...stageGates].sort(
    (left, right) => new Date(left.updated_at).getTime() - new Date(right.updated_at).getTime(),
  );
}

export function summarizeFirstGate(stageGates: DashboardApprovalStageGateRecord[]): string {
  if (stageGates.length === 0) {
    return 'No stage gates waiting';
  }
  return buildGateBreadcrumbs(stageGates[0]).slice(0, 4).join(' • ');
}

export function countPendingOrchestratorFollowUp(
  stageGates: DashboardApprovalStageGateRecord[],
): number {
  return stageGates.filter((gate) => {
    const decisionAction = gate.human_decision?.action;
    const resumeState = gate.orchestrator_resume?.state;
    const activationId = gate.orchestrator_resume?.activation_id;
    return Boolean(decisionAction) && !resumeState && !activationId;
  }).length;
}

export function matchesApprovalSearch(
  query: string,
  gate: DashboardApprovalStageGateRecord | DashboardApprovalTaskRecord,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  const searchCorpus = [
    'stage_name' in gate ? gate.stage_name : '',
    'stage_goal' in gate ? gate.stage_goal : '',
    'summary' in gate ? gate.summary : '',
    'recommendation' in gate ? gate.recommendation : '',
    'workflow_name' in gate ? gate.workflow_name : '',
    gate.workflow_id,
    'work_item_title' in gate ? gate.work_item_title : '',
    'work_item_id' in gate ? gate.work_item_id : '',
    'role' in gate ? gate.role : '',
    'activation_id' in gate ? gate.activation_id : '',
    'title' in gate ? gate.title : '',
    gate.id,
    'gate_id' in gate ? gate.gate_id : '',
    'request_summary' in gate ? gate.request_summary : '',
    'decision_feedback' in gate ? gate.decision_feedback : '',
    'human_decision' in gate ? gate.human_decision?.feedback : '',
    'human_decision' in gate ? gate.human_decision?.action : '',
    'orchestrator_resume' in gate ? gate.orchestrator_resume?.state : '',
    'orchestrator_resume' in gate ? gate.orchestrator_resume?.event_type : '',
    'orchestrator_resume' in gate ? gate.orchestrator_resume?.reason : '',
    'orchestrator_resume' in gate ? gate.orchestrator_resume?.summary : '',
    'orchestrator_resume' in gate ? gate.orchestrator_resume?.task?.title : '',
    'orchestrator_resume' in gate ? gate.orchestrator_resume?.task?.state : '',
    ...('requested_by_task' in gate ? readGateRequestSourceSummary(gate) : []),
    ...('human_decision' in gate ? [readGateDecisionSummary(gate)] : []),
    ...('orchestrator_resume' in gate ? [readGateResumptionSummary(gate)] : []),
    ...('concerns' in gate ? gate.concerns : []),
    ...('title' in gate ? buildTaskApprovalBreadcrumbs(gate) : []),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase();
  return searchCorpus.includes(normalizedQuery);
}

export function buildTaskApprovalBreadcrumbs(task: DashboardApprovalTaskRecord): string[] {
  const breadcrumbs: string[] = [];
  if (task.workflow_name) {
    breadcrumbs.push(`Board: ${task.workflow_name}`);
  }
  if (task.work_item_title) {
    breadcrumbs.push(`Work item: ${task.work_item_title}`);
  }
  if (task.stage_name) {
    breadcrumbs.push(`Stage: ${task.stage_name}`);
  }
  if (task.role) {
    breadcrumbs.push(`Role: ${task.role}`);
  }
  if (task.activation_id) {
    breadcrumbs.push(`Activation: ${task.activation_id}`);
  }
  return breadcrumbs;
}

export function readTaskOperatorFlowLabel(task: DashboardApprovalTaskRecord): string {
  return readWorkflowOperatorFlowLabel(task);
}

export { usesWorkItemOperatorFlow };
