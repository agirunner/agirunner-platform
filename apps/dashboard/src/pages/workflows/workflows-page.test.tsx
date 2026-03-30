import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './workflows-page.tsx',
    './workflows-layout.ts',
    './workflows-page.support.ts',
    './workflows-query.ts',
    './workflow-state-strip.tsx',
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
    expect(source).toContain('WorkflowLaunchDialog');
    expect(source).toContain('WorkflowAddWorkDialog');
    expect(source).toContain('WorkflowSteering');
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
    expect(source).toContain('buildWorkflowWorkspaceSplitClassName');
    expect(source).toContain('buildWorkflowWorkspaceSplitStyle');
    expect(source).toContain('data-workflows-top-strip="true"');
    expect(source).toContain('data-workflows-board-frame="true"');
    expect(source).toContain('data-workflows-workbench-frame="true"');
    expect(source).toContain('cursor-col-resize');
    expect(source).toContain('cursor-row-resize');
    expect(source).toContain('data-workflows-board-frame="true"\n                className="flex h-full min-h-[11rem] min-w-0 flex-col overflow-hidden rounded-[1.75rem] border border-border/70 bg-card/85 p-0 shadow-sm sm:min-h-[15rem] lg:min-h-0"');
    expect(source).toContain('data-workflows-workbench-frame="true"\n                className="flex h-full min-h-[12rem] min-w-0 flex-col overflow-hidden rounded-[1.75rem] border border-border/70 bg-card/85 p-0 shadow-sm sm:min-h-[16rem] lg:min-h-0"');
    expect(source).toContain('lg:h-full lg:min-h-0 lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden');
    expect(source).toContain('grid min-h-0 w-full min-w-0 gap-3 lg:h-full lg:min-h-0 lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden');
    expect(source).not.toContain('min-h-[calc(100dvh-8.5rem)]');
    expect(source).not.toContain('h-full overflow-visible rounded-[1.75rem] border border-border/70 bg-stone-100/80 p-2 shadow-sm lg:min-h-0 lg:overflow-hidden dark:bg-slate-950/65');
    expect(source).not.toContain('bg-transparent p-1.5');
    expect(source).not.toContain('<div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm">');
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

  it('re-resolves the selected workflow when a live rail refresh no longer contains the previously selected id', () => {
    const source = readSource();

    expect(source).toContain('if (!railPacket || !pageState.workflowId) {');
    expect(source).toContain('if (selectableRows.some((row) => row.workflow_id === pageState.workflowId)) {');
    expect(source).toContain('if (selectedWorkflowRow && !workspaceQuery.isError && !workflowDetailQuery.isError) {');
    expect(source).toContain('currentWorkflowId: null');
    expect(source).toContain('selectedWorkflowId: railPacket.selected_workflow_id');
    expect(source).toContain('workflowId: nextWorkflowId,');
    expect(source).toContain('workItemId: null,');
    expect(source).toContain('tab: null,');
  });

  it('keeps the rail query and realtime stream independent from the selected workflow id', () => {
    const source = readSource();

    expect(source).not.toContain('workflowId: pageState.workflowId ?? undefined');
    expect(source).not.toContain("workflow_id: input?.workflowId");
    expect(source).not.toContain('buildWorkflowRailQueryKey({\n            mode: input.mode,\n            search: input.search,\n            needsActionOnly: input.needsActionOnly,\n            ongoingOnly: input.ongoingOnly,\n            workflowId: input.workflowId,');
  });

  it('keeps the previous workspace shell mounted while scoped work-item selections refetch', () => {
    const source = readSource();
    expect(source).toContain('lastWorkspacePacketRef');
    expect(source).toContain('const requestedWorkspaceScope = {');
    expect(source).toContain('const workspacePacket = workspaceQuery.data');
    expect(source).toContain('resolveWorkspacePlaceholderData(previous, requestedWorkspaceScope)');
    expect(source).toContain('const isScopeLoading =');
    expect(source).toContain('workspaceQuery.isPlaceholderData');
    expect(source).toContain('!workspacePacketMatchesScope(lastWorkspacePacketRef.current, requestedWorkspaceScope)');
    expect(source).toContain('isScopeLoading={isScopeLoading}');
    expect(source).toContain('lastWorkspacePacketRef.current ?? undefined');
    expect(source).toContain('requestedWorkspaceScope');
    expect(source).not.toContain('workflow && workspaceQuery.data ? (');
    expect(source).not.toContain('placeholderData: (previous) => previous');
  });

  it('treats board task clicks as parent work-item selection and removes the task lens toggle', () => {
    const source = readSource();
    expect(source).not.toContain("resolveBoardSelectionForLens('work_items'");
    expect(source).not.toContain('selectedTaskId=');
    expect(source).not.toContain('selectedTask={');
    expect(source).not.toContain('selectedTaskTitle=');
    expect(source).not.toContain('boardLens="work_items"');
    expect(source).not.toContain('onBoardLensChange={() => undefined}');
    expect(source).not.toContain("onSelectTask={(workItemId) =>");
    expect(source).not.toContain('taskId: pageState.taskId');
    expect(source).not.toContain('onClearTaskScope={() => undefined}');
    expect(source).toContain('const handleSelectWorkItem = (workItemId: string) => {');
    expect(source).toContain("patchPageState(navigate, pageState, { workItemId, tab: 'details' })");
    expect(source).toContain("const handleClearWorkItemScope = () => {");
    expect(source).toContain('onClearWorkItemScope={handleClearWorkItemScope}');
    expect(source).toContain('patchPageState(navigate, pageState, { workItemId: null })');
    expect(source).toContain('onSelectWorkItem={handleSelectWorkItem}');
    expect(source).not.toContain("label=\"Tasks\"");
  });

  it('routes work-item local controls through page-level handlers and keeps steering out of the empty workspace copy', () => {
    const source = readSource();

    expect(source).toContain('const [isSteeringOpen, setIsSteeringOpen] = useState(false);');
    expect(source).toContain('const [steeringTargetWorkItemId, setSteeringTargetWorkItemId] = useState<string | null>(null);');
    expect(source).toContain('onWorkItemAction={({ workItemId, action }) => {');
    expect(source).toContain("case 'needs-action':");
    expect(source).toContain("tab: 'needs_action'");
    expect(source).toContain("case 'steer':");
    expect(source).toContain('setSteeringTargetWorkItemId(workItemId);');
    expect(source).toContain('setIsSteeringOpen(true);');
    expect(source).toContain("case 'repeat':");
    expect(source).toContain('setAddWorkTargetWorkItemId(null);');
    expect(source).toContain('setRepeatSourceWorkItemId(workItemId);');
    expect(source).toContain('setIsAddWorkOpen(true);');
    expect(source).toContain('<WorkflowSteering');
    expect(source).not.toContain('workflow && workspacePacket && selectedWorkItem ? (');
    expect(source).not.toContain('WorkflowRedriveDialog');
    expect(source).not.toContain('setIsRedriveOpen(true);');
    expect(source).not.toContain('open its board, steering, history, live console,');
  });

  it('opens header add-or-modify in modify mode for selected work items only', () => {
    const source = readSource();

    expect(source).toContain('const [addWorkTargetWorkItemId, setAddWorkTargetWorkItemId] = useState<string | null>(null);');
    expect(source).toContain('describeHeaderAddWorkLabel');
    expect(source).toContain('resolveHeaderAddWorkTargetWorkItemId');
    expect(source).toContain('onAddWork={() => {');
    expect(source).toContain('scopeKind: tabScope');
    expect(source).toContain('workItemId: boardSelection.workItemId');
    expect(source).toContain('addWorkLabel={describeHeaderAddWorkLabel({');
    expect(source).toContain('workItemId={addWorkTargetWorkItemId}');
    expect(source).not.toContain('workItemId={boardSelection.workItemId}');
  });

  it('keeps the workflows surface framed as three separated sections instead of a flattened transparent shell', () => {
    const source = readSource();

    expect(source).toContain('data-workflows-top-strip="true"');
    expect(source).toContain('data-workflows-board-frame="true"');
    expect(source).toContain('data-workflows-workbench-frame="true"');
    expect(source).toContain('data-workflows-top-strip="true"\n            className="grid shrink-0 gap-2.5 sm:gap-3"');
    expect(source).toContain('function HeaderCard(props: {');
    expect(source).not.toContain('data-workflows-top-strip="true"\n            className="grid shrink-0 gap-2.5 rounded-[1.75rem] border border-border/70 bg-card/85 p-3 shadow-sm sm:gap-3 sm:p-4"');
    expect(source).not.toContain('data-workflows-top-strip="true"\n            className="grid shrink-0 gap-2 rounded-[1.75rem] border border-border/70 bg-stone-100/80 p-2 shadow-sm dark:bg-slate-950/65"');
    expect(source).not.toContain('data-workflows-top-strip="true"\n            className="grid gap-2 rounded-[1.75rem] border border-border/70 bg-transparent p-1.5"');
    expect(source).not.toContain('<div className="h-full overflow-visible rounded-[1.75rem] border border-border/70 bg-stone-100/80 p-2 shadow-sm lg:min-h-0 lg:overflow-hidden dark:bg-slate-950/65">');
  });

  it('avoids nested shell frames around the board and lower panel sections', () => {
    const source = readSource();

    expect(source).toContain('data-workflows-board-frame="true"');
    expect(source).toContain('data-workflows-workbench-frame="true"');
    expect(source).toContain('data-workflows-board-frame="true"\n                className="flex h-full min-h-[11rem] min-w-0 flex-col overflow-hidden rounded-[1.75rem] border border-border/70 bg-card/85 p-0 shadow-sm sm:min-h-[15rem] lg:min-h-0"');
    expect(source).toContain('data-workflows-workbench-frame="true"\n                className="flex h-full min-h-[12rem] min-w-0 flex-col overflow-hidden rounded-[1.75rem] border border-border/70 bg-card/85 p-0 shadow-sm sm:min-h-[16rem] lg:min-h-0"');
    expect(source).toContain('data-workflows-workbench-frame="true"\n              className="flex h-full min-h-[12rem] min-w-0 flex-col overflow-hidden rounded-[1.75rem] border border-border/70 bg-card/85 p-0 shadow-sm sm:min-h-[16rem] lg:min-h-0"');
  });

  it('keeps phone layout reachable by dropping the extra viewport-height lock and shrinking mobile panel minimums', () => {
    const source = readSource();

    expect(source).toContain('grid min-h-0 w-full min-w-0 gap-3 lg:h-full lg:min-h-0 lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden');
    expect(source).toContain('data-workflows-board-frame="true"\n                className="flex h-full min-h-[11rem] min-w-0 flex-col overflow-hidden rounded-[1.75rem] border border-border/70 bg-card/85 p-0 shadow-sm sm:min-h-[15rem] lg:min-h-0"');
    expect(source).toContain('data-workflows-workbench-frame="true"\n                className="flex h-full min-h-[12rem] min-w-0 flex-col overflow-hidden rounded-[1.75rem] border border-border/70 bg-card/85 p-0 shadow-sm sm:min-h-[16rem] lg:min-h-0"');
    expect(source).not.toContain('min-h-[calc(100dvh-8.5rem)]');
    expect(source).not.toContain('data-workflows-board-frame="true"\n                className="flex min-h-[15rem] min-w-0 flex-col overflow-hidden rounded-[1.75rem] border border-border/70 bg-card/85 p-0 shadow-sm lg:min-h-0"');
  });

  it('keeps the desktop board and lower workbench frames explicitly stretched inside the split tracks', () => {
    const source = readSource();

    expect(source).toContain('lg:items-stretch');
    expect(source).toContain('className="flex h-full min-h-[11rem] min-w-0 flex-col overflow-hidden rounded-[1.75rem] border border-border/70 bg-card/85 p-0 shadow-sm sm:min-h-[15rem] lg:min-h-0"');
    expect(source).toContain('className="flex h-full min-h-[12rem] min-w-0 flex-col overflow-hidden rounded-[1.75rem] border border-border/70 bg-card/85 p-0 shadow-sm sm:min-h-[16rem] lg:min-h-0"');
  });

  it('uses tighter shell height math so the board and lower panel run closer to the viewport bottom', () => {
    const source = readSource();

    expect(source).toContain("'flex-1'");
    expect(source).toContain("'h-full'");
    expect(source).toContain("'min-h-0'");
    expect(source).not.toContain("const WORKFLOWS_SHELL_MIN_HEIGHT_CLASS =");
    expect(source).not.toContain("const WORKFLOWS_SHELL_HEIGHT_CLASS =");
  });
});
