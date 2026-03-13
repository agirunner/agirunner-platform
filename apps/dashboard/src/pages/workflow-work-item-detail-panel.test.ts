import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(
    resolve(import.meta.dirname, './workflow-work-item-detail-panel.tsx'),
    'utf8',
  );
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
    expect(source).toContain('grid h-auto w-full grid-cols-2');
    expect(source).toContain('xl:grid-cols-4');
    expect(source).toContain('TabsTrigger value="steps"');
    expect(source).toContain('TabsTrigger value="memory"');
    expect(source).toContain('TabsTrigger value="artifacts"');
    expect(source).toContain('TabsTrigger value="history"');
  });

  it('loads truthful work-item memory and memory history from dashboard api methods', () => {
    const source = readSource();
    expect(source).toContain('listWorkflowWorkItemEvents');
    expect(source).toContain('getWorkflowWorkItemMemory');
    expect(source).toContain('getWorkflowWorkItemMemoryHistory');
    expect(source).toContain('Current memory');
    expect(source).toContain('Memory history');
    expect(source).toContain('Memory packet');
    expect(source).toContain('Memory change packet');
    expect(source).toContain('Updated {formatRelativeTimestamp(entry.updated_at)}');
    expect(source).toContain('Open full memory packet');
    expect(source).toContain('Open full change packet');
    expect(source).toContain('formatMemoryHistoryEventType');
    expect(source).toContain('Deleted value');
    expect(source).toContain('Created {formatRelativeTimestamp(artifact.created_at)}');
    expect(source).toContain('step {entry.task_id}');
  });

  it('surfaces milestone operator context with parent-child navigation and grouped task messaging', () => {
    const source = readSource();
    expect(source).toContain('Operator breadcrumb');
    expect(source).toContain('Board placement');
    expect(source).toContain('Stage and board routing');
    expect(source).toContain('Ownership and linkage');
    expect(source).toContain('Milestone decomposition');
    expect(source).toContain('Unsaved operator changes');
    expect(source).toContain('No pending control changes');
    expect(source).toContain('OperatorSectionCard');
    expect(source).toContain('Milestone group summary');
    expect(source).toContain('Operator attention');
    expect(source).toContain('Active footprint');
    expect(source).toContain('Milestone children');
    expect(source).toContain('Open parent milestone');
    expect(source).toContain('children complete');
    expect(source).toContain('Showing execution steps linked to this milestone and its');
    expect(source).toContain('Linked execution steps stay here');
    expect(source).toContain('Operator Flow Controls');
    expect(source).toContain('Reparent under milestone');
    expect(source).toContain('Select owner role');
    expect(source).toContain('Unassigned');
    expect(source).toContain('Choose from roles already active on this board run');
    expect(source).toContain('Save Operator Changes');
    expect(source).toContain('Create Child Work Item');
    expect(source).toContain('Execution review packet');
    expect(source).toContain('Requires operator attention');
    expect(source).toContain('Execution queue');
    expect(source).toContain('Operator next step');
    expect(source).toContain('Approve Step');
    expect(source).toContain('Request Changes');
    expect(source).toContain('Retry Step');
    expect(source).toContain('Resume with Guidance');
    expect(source).toContain('Cancel Step');
    expect(source).toContain('Focus work item');
    expect(source).toContain('Open step record');
    expect(source).toContain('Stage group');
    expect(source).toContain('Open child work-item flow');
    expect(source).toContain('dashboardApi.updateWorkflowWorkItem');
    expect(source).toContain('dashboardApi.createWorkflowWorkItem');
    expect(source).toContain('dashboardApi.approveTask');
    expect(source).toContain('dashboardApi.requestTaskChanges');
    expect(source).toContain('dashboardApi.retryTask');
    expect(source).toContain('dashboardApi.resolveEscalation');
    expect(source).toContain('dashboardApi.cancelTask');
    expect(source).toContain('Provide Operator Guidance');
    expect(source).toContain('Describe the operator guidance needed to resume this step...');
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
    expect(source).not.toContain('access_url ?? artifact.download_url');
  });

  it('uses human-readable descriptors for work-item event history instead of raw event codes', () => {
    const source = readSource();
    expect(source).toContain("import { WorkItemEventHistorySection } from './workflow-work-item-history-section.js';");
    expect(source).toContain('<WorkItemEventHistorySection');
    expect(source).not.toContain('formatTimelineEventType');
    expect(source).not.toContain('<strong>{event.type}</strong>');
  });
});
