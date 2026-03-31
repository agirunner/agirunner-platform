import type {
  DashboardMissionControlWorkflowCard,
  DashboardWorkflowBoardResponse,
  DashboardWorkflowInputPacketRecord,
  DashboardWorkflowStickyStrip,
  DashboardWorkflowWorkItemRecord,
} from '../../../lib/api.js';
import type { WorkflowWorkbenchScopeDescriptor } from '../workflows-page.support.js';
import { BriefSection, Narrative, WhatExistsNowBody } from './details/workflow-details.sections.js';
import {
  buildCurrentState,
  buildDetailsScope,
  buildWhatExistsNow,
  buildWhatWasAsked,
  normalizeDetailsScope,
} from './details/workflow-details.support.js';

export function WorkflowDetails(props: {
  workflow: DashboardMissionControlWorkflowCard;
  stickyStrip: DashboardWorkflowStickyStrip | null;
  board: DashboardWorkflowBoardResponse | null;
  selectedWorkItemId: string | null;
  selectedWorkItemTitle: string | null;
  selectedWorkItem: DashboardWorkflowWorkItemRecord | null;
  selectedWorkItemTasks: Record<string, unknown>[];
  inputPackets: DashboardWorkflowInputPacketRecord[];
  workflowParameters: Record<string, unknown> | null;
  scope: WorkflowWorkbenchScopeDescriptor;
}): JSX.Element {
  const normalizedScope = normalizeDetailsScope(props.scope);
  const selectedWorkItemId = props.selectedWorkItem?.id ?? props.selectedWorkItemId ?? null;
  const isWorkflowScope = normalizedScope.scopeKind === 'workflow';
  const workflowPackets = props.inputPackets.filter((packet) => packet.work_item_id === null);
  const workItemPackets =
    !isWorkflowScope && selectedWorkItemId
      ? props.inputPackets.filter((packet) => packet.work_item_id === selectedWorkItemId)
      : [];

  const scope = buildDetailsScope({ ...props, scope: normalizedScope });
  const whatWasAsked = buildWhatWasAsked({
    isWorkflowScope,
    workflowParameters: props.workflowParameters,
    selectedWorkItem: props.selectedWorkItem,
    selectedWorkItemTasks: props.selectedWorkItemTasks,
    workflowPackets,
    workItemPackets,
  });
  const currentState = buildCurrentState({
    isWorkflowScope,
    workflow: props.workflow,
    board: props.board,
    selectedWorkItem: props.selectedWorkItem,
  });
  const whatExistsNow = buildWhatExistsNow({
    isWorkflowScope,
    board: props.board,
    selectedWorkItemTasks: props.selectedWorkItemTasks,
    workflowPackets,
    workItemPackets,
  });

  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pb-1 pr-1">
      <p className="text-sm text-foreground">{scope.latestStatus}</p>

      <div className="grid gap-4">
        <BriefSection title="What was asked">
          <Narrative paragraphs={whatWasAsked} fallback="No operator brief is attached yet." />
        </BriefSection>

        <BriefSection title="Current state">
          <Narrative paragraphs={currentState} fallback="Current workflow state is still loading." />
        </BriefSection>

        <BriefSection title="What exists now">
          <WhatExistsNowBody rows={whatExistsNow.rows} files={whatExistsNow.files} />
        </BriefSection>
      </div>
    </section>
  );
}
