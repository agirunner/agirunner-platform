import { describe, expect, it } from 'vitest';

import {
  readApiSource,
  readExportBlock,
  readInterfaceBlock,
} from './contracts.source-test-support.js';

describe('dashboard api contract source', () => {
  it('keeps live workflow contracts free of template and phase-era fields', () => {
    const workflowBlock = readExportBlock(readApiSource(), 'DashboardWorkflowRecord');

    expect(workflowBlock).not.toContain('template_id');
    expect(workflowBlock).not.toContain('template_name');
    expect(workflowBlock).not.toContain('template_version');
    expect(workflowBlock).not.toContain('current_phase');
    expect(workflowBlock).not.toContain('workflow_phase');
    expect(workflowBlock).not.toContain('phases');
  });

  it('keeps dashboard workflow and task records on canonical state aliases', () => {
    const source = readApiSource();
    const workflowBaseBlock = readInterfaceBlock(source, 'DashboardWorkflowRecordBase');
    const workflowBlock = readExportBlock(source, 'DashboardWorkflowRecord');

    expect(source).toContain('export type DashboardTaskState = TaskState;');
    expect(source).toContain('export type DashboardWorkflowState = WorkflowState;');
    expect(source).toContain('export interface DashboardTaskRecord extends Task {');
    expect(workflowBaseBlock).toContain('state: DashboardWorkflowState;');
    expect(workflowBlock).toContain("lifecycle: 'ongoing';");
    expect(workflowBlock).toContain('current_stage?: never;');
    expect(workflowBlock).toContain("lifecycle?: 'planned' | null;");
    expect(workflowBlock).toContain('current_stage?: string | null;');
    expect(workflowBlock).not.toContain('current_checkpoint');
    expect(source).not.toContain('DashboardApprovalTaskRecord');
    expect(source).not.toContain('DashboardWorkflowWorkItemCheckpointCompatibility');
    expect(source).not.toContain('DashboardWorkflowWorkItemCheckpointKey');
    expect(source).not.toContain('actOnStageGate(');
  });

  it('keeps workflow work-item actions on the workflow-scoped contract', () => {
    const source = readApiSource();
    const apiBlock = readExportBlock(source, 'DashboardApi');
    expect(apiBlock).toContain('retryWorkflowWorkItem(');
    expect(source).toContain(
      "requestWorkflowWorkItemAction(workflowId, workItemId, 'retry', payload)",
    );
    expect(apiBlock).toContain('skipWorkflowWorkItem(');
    expect(source).toContain(
      "requestWorkflowWorkItemAction(workflowId, workItemId, 'skip', payload)",
    );
    expect(apiBlock).toContain('reassignWorkflowWorkItemTask(');
    expect(source).toContain('requestWorkflowWorkItemTaskAction(');
    expect(source).toContain("'reassign'");
    expect(source).toContain('/reassign');
    expect(apiBlock).toContain('resolveWorkflowWorkItemTaskEscalation(');
    expect(source).toContain("'resolve-escalation'");
    expect(source).toContain('/resolve-escalation');
  });

  it('exposes typed workspace settings posture in the dashboard api contract', () => {
    const source = readApiSource();
    const workspaceSettingsBlock = readExportBlock(source, 'DashboardWorkspaceSettingsRecord');
    const workspaceSettingsInputBlock = readExportBlock(source, 'DashboardWorkspaceSettingsInput');
    const workspaceSummaryBlock = readExportBlock(source, 'DashboardWorkspaceListSummary');
    const workspaceRecordBlock = readExportBlock(source, 'DashboardWorkspaceRecord');
    const patchWorkspaceBlock = readExportBlock(source, 'DashboardWorkspacePatchInput');

    expect(workspaceSettingsBlock).toContain('default_branch?: string | null;');
    expect(workspaceSettingsBlock).toContain('git_user_name?: string | null;');
    expect(workspaceSettingsBlock).toContain('git_user_email?: string | null;');
    expect(workspaceSettingsBlock).toContain('credentials?: DashboardWorkspaceCredentialPosture;');
    expect(workspaceSettingsBlock).not.toContain(
      'model_overrides?: Record<string, DashboardRoleModelOverride>;',
    );
    expect(workspaceSettingsBlock).toContain('workspace_brief?: string | null;');
    expect(workspaceSettingsInputBlock).toContain(
      'credentials?: DashboardWorkspaceCredentialInput;',
    );
    expect(workspaceSettingsInputBlock).not.toContain(
      'model_overrides?: Record<string, DashboardRoleModelOverride>;',
    );
    expect(workspaceSummaryBlock).toContain('active_workflow_count: number;');
    expect(workspaceSummaryBlock).toContain('completed_workflow_count: number;');
    expect(workspaceSummaryBlock).toContain('attention_workflow_count: number;');
    expect(workspaceRecordBlock).toContain('settings?: DashboardWorkspaceSettingsRecord;');
    expect(workspaceRecordBlock).toContain('summary?: DashboardWorkspaceListSummary;');
    expect(patchWorkspaceBlock).toContain('settings?: DashboardWorkspaceSettingsInput;');
  });

  it('exposes execution backend and tool ownership in dashboard api contracts', () => {
    const source = readApiSource();
    const toolTagBlock = readInterfaceBlock(source, 'DashboardToolTagRecord');
    const taskBlock = source.slice(
      source.indexOf('export interface DashboardTaskRecord extends Task {'),
      source.indexOf(
        '\n}\n',
        source.indexOf('export interface DashboardTaskRecord extends Task {'),
      ),
    );
    const logEntryBlock = readInterfaceBlock(source, 'LogEntry');
    const liveContainerBlock = readInterfaceBlock(source, 'DashboardLiveContainerRecord');

    expect(toolTagBlock).toContain("owner?: 'runtime' | 'task';");
    expect(taskBlock).toContain("execution_backend: 'runtime_only' | 'runtime_plus_task';");
    expect(taskBlock).toContain('used_task_sandbox: boolean;');
    expect(taskBlock).toContain(
      'execution_environment?: DashboardExecutionEnvironmentRecord | null;',
    );
    expect(logEntryBlock).toContain(
      "execution_backend?: 'runtime_only' | 'runtime_plus_task' | null;",
    );
    expect(logEntryBlock).toContain("tool_owner?: 'runtime' | 'task' | null;");
    expect(logEntryBlock).toContain('execution_environment_name?: string | null;');
    expect(logEntryBlock).toContain('execution_environment_image?: string | null;');
    expect(logEntryBlock).toContain('execution_environment_distro?: string | null;');
    expect(logEntryBlock).toContain('execution_environment_package_manager?: string | null;');
    expect(liveContainerBlock).toContain(
      "execution_backend?: 'runtime_only' | 'runtime_plus_task' | null;",
    );
    expect(liveContainerBlock).toContain('execution_environment_name?: string | null;');
    expect(liveContainerBlock).toContain('execution_environment_image?: string | null;');
    expect(liveContainerBlock).toContain('execution_environment_distro?: string | null;');
    expect(liveContainerBlock).toContain('execution_environment_package_manager?: string | null;');
  });

  it('exposes typed mission control read models and read methods in the dashboard api contract', () => {
    const source = readApiSource();
    const apiBlock = readExportBlock(source, 'DashboardApi');
    const liveBlock = readExportBlock(source, 'DashboardMissionControlLiveResponse');
    const sectionBlock = readExportBlock(source, 'DashboardMissionControlLiveSection');
    const cardBlock = readExportBlock(source, 'DashboardMissionControlWorkflowCard');
    const packetBlock = readExportBlock(source, 'DashboardMissionControlPacket');
    const workspaceBlock = readExportBlock(source, 'DashboardMissionControlWorkspaceResponse');
    const actionBlock = readExportBlock(source, 'DashboardMissionControlActionAvailability');
    const outputBlock = readExportBlock(source, 'DashboardMissionControlOutputDescriptor');

    expect(apiBlock).toContain('getMissionControlLive(');
    expect(apiBlock).toContain('getMissionControlRecent(');
    expect(apiBlock).toContain('getMissionControlHistory(');
    expect(apiBlock).toContain('getMissionControlWorkflowWorkspace(');
    expect(liveBlock).toContain('sections: DashboardMissionControlLiveSection[];');
    expect(liveBlock).toContain('attentionItems: DashboardMissionControlAttentionItem[];');
    expect(sectionBlock).toContain(
      "id: 'needs_action' | 'at_risk' | 'progressing' | 'waiting' | 'recently_changed';",
    );
    expect(cardBlock).toContain('posture: DashboardMissionControlWorkflowPosture;');
    expect(cardBlock).toContain('outputDescriptors: DashboardMissionControlOutputDescriptor[];');
    expect(cardBlock).toContain('availableActions: DashboardMissionControlActionAvailability[];');
    expect(packetBlock).toContain('carryover: boolean;');
    expect(workspaceBlock).toContain('workflow: DashboardMissionControlWorkflowCard | null;');
    expect(workspaceBlock).toContain('overview: DashboardMissionControlWorkspaceOverview | null;');
    expect(workspaceBlock).toContain('interventionHistory: DashboardMissionControlPacket[];');
    expect(actionBlock).toContain('confirmationLevel: DashboardMissionControlConfirmationLevel;');
    expect(outputBlock).toContain('primaryLocation: DashboardMissionControlOutputLocation;');
  });
});
