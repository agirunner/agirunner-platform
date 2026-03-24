import type {
  DashboardWorkflowActivationRecord,
  DashboardWorkflowRecord,
  DashboardWorkflowStageRecord,
  DashboardWorkflowWorkItemRecord,
} from '../../lib/api.js';
import { buildWorkspaceArtifactBrowserPath } from '../../lib/artifact-navigation.js';
import type { WorkflowInspectorTraceLink } from './workflow-inspector-support.js';

export function buildWorkflowInspectorTraceLinks(
  workflow: DashboardWorkflowRecord | undefined,
  workspaceId: string | null,
  readLatestActivation: (
    activations: DashboardWorkflowActivationRecord[],
  ) => DashboardWorkflowActivationRecord | null,
): WorkflowInspectorTraceLink[] {
  const workflowId = workflow?.id ?? '';
  const activations = Array.isArray(workflow?.activations) ? workflow.activations : [];
  const stages = Array.isArray(workflow?.workflow_stages) ? workflow.workflow_stages : [];
  const workItems = Array.isArray(workflow?.work_items) ? workflow.work_items : [];
  const links: WorkflowInspectorTraceLink[] = [
    {
      label: 'Board trace',
      href: `/work/boards/${workflowId}`,
      detail: 'Open activations, work items, gates, and specialist steps in one board view.',
    },
  ];

  const latestActivation = readLatestActivation(activations);
  if (latestActivation) {
    links.push({
      label: 'Activation drill-in',
      href: buildWorkflowInspectorLogLink(workflowId, {
        view: 'detailed',
        activation: latestActivation.activation_id ?? latestActivation.id,
      }),
      detail:
        latestActivation.summary
        ?? `${humanizeToken(latestActivation.reason)} is the latest activation packet on this workflow.`,
    });
  }

  const highlightedWorkItem = readHighlightedWorkItem(workItems);
  if (highlightedWorkItem) {
    links.push({
      label: 'Open work item',
      href: buildWorkflowBoardLink(workflowId, { work_item: highlightedWorkItem.id }),
      detail: `${highlightedWorkItem.title} is still open in ${highlightedWorkItem.stage_name}.`,
    });
  }

  const highlightedGateStage = readHighlightedGateStage(stages);
  if (highlightedGateStage) {
    links.push({
      label: 'Gate decision lane',
      href: buildWorkflowBoardLink(workflowId, { stage: highlightedGateStage.name }),
      detail: `${highlightedGateStage.name} is carrying the current gate decision posture for this workflow.`,
    });
  }

  if (workspaceId) {
    links.push(
      {
        label: 'Workspace memory',
        href: `/workspaces/${workspaceId}/memory`,
        detail: 'Inspect memory versions, diffs, and run handoff packets.',
      },
      {
        label: 'Workspace artifacts',
        href: buildWorkspaceArtifactBrowserPath(workspaceId, { workflowId }),
        detail: 'Review delivered artifacts and workflow output packets.',
      },
    );
  }

  return links;
}

export function readHighlightedWorkItem(
  workItems: DashboardWorkflowWorkItemRecord[],
): DashboardWorkflowWorkItemRecord | null {
  return workItems.find((item) => !item.completed_at)
    ?? workItems
      .slice()
      .sort((left, right) => Date.parse(right.updated_at ?? '') - Date.parse(left.updated_at ?? ''))[0]
    ?? null;
}

function readHighlightedGateStage(
  stages: DashboardWorkflowStageRecord[],
): DashboardWorkflowStageRecord | null {
  const activeGate = stages.find((stage) =>
    ['awaiting_approval', 'changes_requested', 'rejected'].includes(stage.gate_status),
  );
  if (activeGate) {
    return activeGate;
  }
  return stages.find((stage) => stage.gate_status !== 'not_requested') ?? null;
}

function buildWorkflowBoardLink(
  workflowId: string,
  params: Record<string, string>,
): string {
  const searchParams = new URLSearchParams(params);
  const query = searchParams.toString();
  return query
    ? `/work/boards/${workflowId}?${query}`
    : `/work/boards/${workflowId}`;
}

function buildWorkflowInspectorLogLink(
  workflowId: string,
  params: { view: 'summary' | 'detailed' | 'debug'; activation?: string },
): string {
  const searchParams = new URLSearchParams({ view: params.view });
  if (params.activation) {
    searchParams.set('activation', params.activation);
  }
  return `/work/boards/${workflowId}/inspector?${searchParams.toString()}`;
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').trim();
}
