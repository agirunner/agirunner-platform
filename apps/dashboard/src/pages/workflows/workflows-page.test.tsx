import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './workflows-page.tsx',
    './workflows-page.support.ts',
    './workflows-query.ts',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('workflows page source', () => {
  it('frames workflows as a selected-workflow shell with rail, sticky state, persistent board, and bottom workbench', () => {
    const source = readSource();
    expect(source).toContain('WorkflowsRail');
    expect(source).toContain('WorkflowStateStrip');
    expect(source).toContain('WorkflowBoard');
    expect(source).toContain('WorkflowBottomWorkbench');
    expect(source).toContain('selectedTaskId');
    expect(source).toContain("taskId: null");
    expect(source).toContain('WorkflowLaunchDialog');
    expect(source).toContain('WorkflowAddWorkDialog');
    expect(source).toContain('WorkflowRedriveDialog');
    expect(source).toContain('getWorkflowRail');
    expect(source).toContain('getWorkflowWorkspace');
    expect(source).toContain('useWorkflowRailRealtime');
    expect(source).toContain('useWorkflowWorkspaceRealtime');
    expect(source).toContain('readWorkflowsPageState');
    expect(source).toContain('buildWorkflowsPageSearchParams');
    expect(source).toContain('resolveWorkflowTabScope');
    expect(source).toContain('resolveSelectedWorkflowId');
    expect(source).toContain('readStoredWorkflowRailWidth');
    expect(source).toContain('readStoredWorkflowWorkbenchFraction');
    expect(source).toContain('writeStoredWorkflowRailWidth');
    expect(source).toContain('writeStoredWorkflowWorkbenchFraction');
    expect(source).toContain('buildWorkflowsShellStyle');
    expect(source).toContain('buildWorkflowWorkspaceSplitStyle');
    expect(source).toContain('cursor-col-resize');
    expect(source).toContain('cursor-row-resize');
    expect(source).not.toContain('MissionControlPage');
    expect(source).not.toContain('MissionControlWorkspacePane');
    expect(source).not.toContain('SavedViews');
    expect(source).not.toContain('Attention rail');
  });

  it('does not clear the active workflow when rail mode, search, and filters change', () => {
    const source = readSource();
    expect(source).not.toContain('{ mode, workflowId: null, workItemId: null, tab: null }');
    expect(source).not.toContain('{ search, workflowId: null, workItemId: null }');
    expect(source).not.toContain('{ needsActionOnly, workflowId: null, workItemId: null }');
  });

  it('keeps the previous workspace shell mounted while scoped work-item selections refetch', () => {
    const source = readSource();
    expect(source).toContain('lastWorkspacePacketRef');
    expect(source).toContain('const requestedWorkspaceScope = {');
    expect(source).toContain('const workspacePacket = workspaceQuery.data');
    expect(source).toContain('resolveWorkspacePlaceholderData(previous, requestedWorkspaceScope)');
    expect(source).toContain('lastWorkspacePacketRef.current ?? undefined');
    expect(source).toContain('requestedWorkspaceScope');
    expect(source).not.toContain('workflow && workspaceQuery.data ? (');
    expect(source).not.toContain('placeholderData: (previous) => previous');
  });
});
