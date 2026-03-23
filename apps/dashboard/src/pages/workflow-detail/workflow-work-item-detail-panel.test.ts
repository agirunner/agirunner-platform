import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './workflow-work-item-detail-panel.tsx',
    './workflow-work-item-task-actions.ts',
    './workflow-work-item-task-review-dialogs.tsx',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('workflow work item detail panel source', () => {
  it('renders a dedicated operator shell with card and table primitives instead of legacy semantic classes', () => {
    const source = readSource();
    expect(source).toContain('data-testid="work-item-detail-shell"');
    expect(source).toContain('data-testid="work-item-operator-controls"');
    expect(source).toContain('data-testid="milestone-operator-summary"');
    expect(source).toContain('<WorkItemEventHistorySection');
    expect(source).toContain('CardHeader');
    expect(source).toContain('CardContent');
    expect(source).toContain('TableHeader');
    expect(source).toContain('TableBody');
    expect(source).toContain('CopyableIdBadge');
    expect(source).toContain('RelativeTimestamp');
    expect(source).toContain('OperatorStatusBadge');
    expect(source).toContain('data-selected-panel="true"');
    expect(source).toContain('data-workflow-focus-anchor="true"');
    expect(source).toContain('tabIndex={-1}');
    expect(source).toContain('aria-labelledby={panelTitleId}');
    expect(source).not.toContain('className="card"');
    expect(source).not.toContain('className="row"');
    expect(source).not.toContain('className="button"');
    expect(source).not.toContain('className="muted"');
    expect(source).not.toContain('className="status-badge"');
    expect(source).not.toContain('timeline-entry');
    expect(source).not.toContain('className="table"');
  });

  it('renders dedicated tabs for steps, memory, artifacts, and event history', () => {
    const source = readSource();
    expect(source).toContain(
      "const responsiveTabTriggerClass = 'h-auto whitespace-normal px-3 py-2 text-center leading-5'",
    );
    expect(source).toContain('TabsTrigger value="summary" className={responsiveTabTriggerClass}');
    expect(source).toContain('TabsTrigger value="operate" className={responsiveTabTriggerClass}');
    expect(source).toContain('TabsTrigger value="evidence" className={responsiveTabTriggerClass}');
    expect(source).toContain('grid h-auto w-full grid-cols-2');
    expect(source).toContain('xl:grid-cols-4');
    expect(source).toContain("describeCountLabel(props.tasks.length, 'linked step')");
    expect(source).toContain("describeCountLabel(artifactQuery.data.length, 'artifact')");
    expect(source).toContain('TabsTrigger value="steps" className={responsiveTabTriggerClass}');
    expect(source).toContain('TabsTrigger value="memory" className={responsiveTabTriggerClass}');
    expect(source).toContain('TabsTrigger value="artifacts" className={responsiveTabTriggerClass}');
    expect(source).toContain('TabsTrigger value="history" className={responsiveTabTriggerClass}');
  });

  it('loads truthful work-item memory and memory history from dashboard api methods', () => {
    const source = readSource();
    expect(source).toContain('listWorkflowWorkItemEvents');
    expect(source).toContain('getWorkflowWorkItemMemory');
    expect(source).toContain('getWorkflowWorkItemMemoryHistory');
    expect(source).toContain('Current memory');
    expect(source).toContain('Memory history');
    expect(source).toContain('No scoped memory yet');
    expect(source).toContain('Waiting for first write');
    expect(source).toContain('No memory changes yet');
    expect(source).toContain('What shows up here');
    expect(source).toContain('Memory packet');
    expect(source).toContain('Memory change packet');
    expect(source).toContain('<RelativeTimestamp value={entry.updated_at} prefix="Updated" />');
    expect(source).toContain('Open full memory packet');
    expect(source).toContain('Open full change packet');
    expect(source).toContain('formatMemoryHistoryEventType');
    expect(source).toContain('Deleted value');
    expect(source).toContain('<RelativeTimestamp value={artifact.created_at} prefix="Created" />');
    expect(source).toContain('<CopyableIdBadge value={entry.task_id} label="Step" />');
  });

  it('surfaces milestone operator context with parent-child navigation and grouped task messaging', () => {
    const source = readSource();
    expect(source).toContain('buildWorkItemRecoveryBrief');
    expect(source).toContain('data-testid="work-item-recovery-brief"');
    expect(source).toContain('Recovery brief');
    expect(source).toContain('props.brief.badge');
    expect(source).toContain('props.brief.facts.map((fact) => (');
    expect(source).toContain('Operator breadcrumb');
    expect(source).toContain('Current routing');
    expect(source).toContain("workItem.stage_name ?? 'Unassigned stage'");
    expect(source).not.toContain('current_checkpoint');
    expect(source).toContain('readContinuitySummary(workItem)');
    expect(source).toContain("workItem.blocked_state === 'blocked'");
    expect(source).toContain('Blocked posture');
    expect(source).toContain('Blocked reason');
    expect(source).toContain('Escalation');
    expect(source).toContain('Branch');
    expect(source).toContain('Retained assessments');
    expect(source).toContain('Invalidated assessments');
    expect(source).toContain('Operator next step:');
    expect(source).toContain('rework loop');
    expect(source).toContain('Stage and board routing');
    expect(source).toContain('Ownership and linkage');
    expect(source).toContain('Milestone decomposition');
    expect(source).toContain('Unsaved operator changes');
    expect(source).toContain('No pending control changes');
    expect(source).toContain('OperatorSectionCard');
    expect(source).toContain('Milestone group summary');
    expect(source).toContain('Operator attention');
    expect(source).toContain('Active footprint');
    expect(source).toContain('WorkItemStageProgressCard');
    expect(source).toContain('Stage progress');
    expect(source).toContain('stage iteration');
    expect(source).toContain('Milestone children');
    expect(source).toContain('Open parent milestone');
    expect(source).toContain('children complete');
    expect(source).toContain('Showing execution steps linked to this milestone and its');
    expect(source).toContain('Linked execution steps stay here');
    expect(source).toContain('Operator Flow Controls');
    expect(source).toContain('Brief and operator notes');
    expect(source).toContain('Brief &amp; metadata');
    expect(source).toContain('Routing &amp; ownership');
    expect(source).toContain('Metadata patch');
    expect(source).toContain('WorkItemMetadataEditor');
    expect(source).toContain('acceptance_criteria: acceptanceCriteria.trim()');
    expect(source).toContain('priority,');
    expect(source).toContain('notes: notes.trim() || null');
    expect(source).toContain('buildWorkItemMetadata(metadataDrafts)');
    expect(source).toContain('lockedMetadataDraftIds');
    expect(source).toContain('Existing keys can be edited here');
    expect(source).toContain('Reparent under milestone');
    expect(source).toContain('Select owner role');
    expect(source).toContain('Unassigned');
    expect(source).toContain('Choose from roles already active on this board run');
    expect(source).toContain('Save Operator Changes');
    expect(source).toContain('Create Child Work Item');
    expect(source).toContain('Milestone plan');
    expect(source).toContain('WorkItemFocusPacket');
    expect(source).toContain('WorkItemHandoffHistorySection');
    expect(source).toContain('WorkItemReviewClosure');
    expect(source).toContain('Summary complete');
    expect(source).toContain('Evidence packet complete');
    expect(source).toContain(
      'Review the summary first. Open controls only when routing or metadata needs to change.',
    );
    expect(source).toContain('need decision');
    expect(source).toContain('history events');
    expect(source).toContain('Handoff history');
    expect(source).toContain('Full execution chain for this work item');
    expect(source).toContain('No handoff history recorded yet.');
    expect(source).toContain('Child acceptance criteria');
    expect(source).toContain('Child notes');
    expect(source).toContain('Add Child Metadata Entry');
    expect(source).toContain('Execution decision packet');
    expect(source).toContain('Requires operator attention');
    expect(source).toContain('Execution queue');
    expect(source).toContain('Operator next step');
    expect(source).toContain('Approve Step');
    expect(source).toContain('Override Output');
    expect(source).toContain('Request Changes');
    expect(source).toContain('Resume with Guidance');
    expect(source).toContain('Cancel Step');
    expect(source).toContain('StepChangesDialog');
    expect(source).toContain('StepEscalationDialog');
    expect(source).toContain('StepOutputOverrideDialog');
    expect(source).toContain('WorkItemReassignDialog');
    expect(source).toContain('DialogContent className="max-h-[75vh] overflow-y-auto sm:max-w-lg"');
    expect(source).toContain('buildWorkItemTaskLinkActions');
    expect(source).toContain('Open work-item flow');
    expect(source).toContain('Open step diagnostics');
    expect(source).toContain('Board-owned step recovery');
    expect(source).toContain('Force Retry Work Item');
    expect(source).toContain('Skip Work Item');
    expect(source).toContain('dashboardApi.retryWorkflowWorkItem(');
    expect(source).toContain('dashboardApi.skipWorkflowWorkItem(');
    expect(source).toContain('Stage group');
    expect(source).toContain('Open child work-item flow');
    expect(source).toContain('dashboardApi.updateWorkflowWorkItem');
    expect(source).toContain('dashboardApi.createWorkflowWorkItem');
    expect(source).toContain('dashboardApi.approveWorkflowWorkItemTaskOutput');
    expect(source).toContain('dashboardApi.approveWorkflowWorkItemTask');
    expect(source).toContain('dashboardApi.rejectWorkflowWorkItemTask');
    expect(source).toContain('dashboardApi.requestWorkflowWorkItemTaskChanges');
    expect(source).toContain('dashboardApi.overrideWorkflowWorkItemTaskOutput');
    expect(source).toContain('dashboardApi.resolveWorkflowWorkItemTaskEscalation');
    expect(source).toContain('dashboardApi.cancelWorkflowWorkItemTask');
    expect(source).not.toContain('dashboardApi.approveTask(');
    expect(source).not.toContain('dashboardApi.approveTaskOutput(');
    expect(source).not.toContain('dashboardApi.rejectTask(');
    expect(source).not.toContain('dashboardApi.requestTaskChanges(');
    expect(source).not.toContain('dashboardApi.retryTask(');
    expect(source).not.toContain('dashboardApi.skipTask(');
    expect(source).not.toContain('dashboardApi.resolveEscalation(');
    expect(source).not.toContain('dashboardApi.cancelTask(');
    expect(source).toContain('Provide Operator Guidance');
    expect(source).toContain('Describe the operator guidance needed to resume this step...');
    expect(source).toContain('Describe why this work item recovery step should be skipped...');
    expect(source).toContain('Reassign Step');
    expect(source).toContain('dashboardApi.listAgents()');
    expect(source).toContain('SearchableCombobox');
    expect(source).toContain('dashboardApi.reassignWorkflowWorkItemTask');
  });

  it('uses a responsive card-plus-table execution layout instead of a table-only task presentation', () => {
    const source = readSource();
    expect(source).toContain('TaskExecutionCard');
    expect(source).toContain('TaskDependencySummary');
    expect(source).toContain('grid gap-3 lg:hidden');
    expect(source).toContain('hidden overflow-x-auto lg:block');
    expect(source).toContain('No dependencies');
    expect(source).toContain('Dependencies');
  });

  it('links artifacts through the dashboard preview permalink instead of direct storage urls', () => {
    const source = readSource();
    expect(source).toContain('buildArtifactPermalink');
    expect(source).toContain('Preview artifact');
    expect(source).toContain('describeWorkItemArtifactIdentity');
    expect(source).toContain('<CopyableIdBadge value={artifact.id} label="Artifact" />');
    expect(source).not.toContain('access_url ?? artifact.download_url');
  });

  it('uses human-readable descriptors for work-item event history instead of raw event codes', () => {
    const source = readSource();
    expect(source).toContain(
      "import { WorkItemEventHistorySection } from './workflow-work-item-history-section.js';",
    );
    expect(source).toContain('<WorkItemEventHistorySection');
    expect(source).not.toContain('formatTimelineEventType');
    expect(source).not.toContain('<strong>{event.type}</strong>');
  });
});
