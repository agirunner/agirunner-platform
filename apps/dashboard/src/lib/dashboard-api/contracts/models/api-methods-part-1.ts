import type {
  DashboardPlaybookRecord,
  DashboardPlaybookDeleteImpact,
  DashboardEventRecord,
  DashboardEventPage,
  DashboardWorkspaceArtifactFileRecord,
  DashboardWorkspaceArtifactFileUploadInput,
  DashboardWorkspaceCreateInput,
  DashboardWorkspacePatchInput,
  DashboardWorkspaceGitAccessVerifyInput,
  DashboardWorkspaceGitAccessVerifyResult,
  DashboardWorkflowBudgetRecord,
  DashboardMissionControlLiveResponse,
  DashboardMissionControlRecentResponse,
  DashboardMissionControlHistoryResponse,
  DashboardMissionControlWorkspaceResponse,
  DashboardWorkflowRailMode,
  DashboardWorkflowRailPacket,
  DashboardWorkflowWorkspacePacket,
  DashboardWorkflowInputPacketRecord,
  DashboardWorkflowInputPacketCreateInput,
  DashboardWorkflowInterventionRecord,
  DashboardWorkflowInterventionCreateInput,
  DashboardWorkflowSteeringSessionRecord,
  DashboardWorkflowSteeringSessionCreateInput,
  DashboardWorkflowSteeringMessageRecord,
  DashboardWorkflowSteeringMessageCreateInput,
  DashboardWorkflowSteeringRequestInput,
  DashboardWorkflowSteeringRequestResult,
  DashboardWorkflowRedriveInput,
  DashboardWorkflowRedriveResult,
  DashboardWorkflowSettingsRecord,
  DashboardWorkflowSettingsPatchInput,
  DashboardAgenticSettingsRecord,
  DashboardAgenticSettingsPatchInput,
  DashboardToolTagRecord,
  DashboardToolTagCreateInput,
  DashboardToolTagUpdateInput,
  DashboardRuntimeDefaultRecord,
  DashboardRuntimeDefaultUpsertInput,
  DashboardExecutionEnvironmentCatalogRecord,
  DashboardExecutionEnvironmentRecord,
  DashboardExecutionEnvironmentCreateInput,
  DashboardExecutionEnvironmentCreateFromCatalogInput,
  DashboardExecutionEnvironmentUpdateInput,
  DashboardRemoteMcpOAuthClientProfileRecord,
  DashboardRemoteMcpOAuthClientProfileCreateInput,
  DashboardRemoteMcpOAuthClientProfileUpdateInput,
  DashboardWorkflowActivationRecord,
  DashboardWorkflowActivationEnqueueInput,
  DashboardWorkflowStageRecord,
  DashboardWorkflowWorkItemRecord,
  DashboardTaskHandoffRecord,
  DashboardWorkItemMemoryEntry,
  DashboardWorkItemMemoryHistoryEntry,
  DashboardWorkflowBoardResponse,
  DashboardWorkflowRecord,
  DashboardWorkspaceRecord,
  DashboardWorkspaceSpecRecord,
  DashboardPlatformInstructionRecord,
  DashboardPlatformInstructionVersionRecord,
  DashboardWorkspaceResourceRecord,
  DashboardWorkspaceToolCatalog,
  DashboardResolvedDocumentReference,
  DashboardWorkflowDocumentCreateInput,
  DashboardWorkflowDocumentUpdateInput,
  DashboardWorkspaceArtifactResponse,
  DashboardWorkspaceArtifactFileDownload,
} from '../models.js';
export interface DashboardApiMethodsPart1 {
  login(apiKey: string, persistentSession?: boolean): Promise<void>;
  logout(): Promise<void>;
  listWorkflows(
      filters?: Record<string, string>,
    ): Promise<{ data: DashboardWorkflowRecord[]; meta?: Record<string, unknown> }>;
  listWorkspaces(): Promise<{ data: DashboardWorkspaceRecord[]; meta?: Record<string, unknown> }>;
  createWorkspace(payload: DashboardWorkspaceCreateInput): Promise<DashboardWorkspaceRecord>;
  patchWorkspace(
      workspaceId: string,
      payload: DashboardWorkspacePatchInput,
    ): Promise<DashboardWorkspaceRecord>;
  verifyWorkspaceGitAccess(
      workspaceId: string,
      payload: DashboardWorkspaceGitAccessVerifyInput,
    ): Promise<DashboardWorkspaceGitAccessVerifyResult>;
  getWorkspace(workspaceId: string): Promise<DashboardWorkspaceRecord>;
  getPlatformInstructions(): Promise<DashboardPlatformInstructionRecord>;
  updatePlatformInstructions(payload: {
      content: string;
      format?: 'text' | 'markdown';
    }): Promise<DashboardPlatformInstructionRecord>;
  clearPlatformInstructions(): Promise<DashboardPlatformInstructionRecord>;
  listPlatformInstructionVersions(): Promise<DashboardPlatformInstructionVersionRecord[]>;
  getPlatformInstructionVersion(
      version: number,
    ): Promise<DashboardPlatformInstructionVersionRecord>;
  getOrchestratorConfig(): Promise<{ prompt: string; updatedAt: string }>;
  updateOrchestratorConfig(payload: {
      prompt: string;
    }): Promise<{ prompt: string; updatedAt: string }>;
  getWorkspaceSpec(workspaceId: string): Promise<DashboardWorkspaceSpecRecord>;
  listWorkspaceArtifacts(
      workspaceId: string,
      filters?: Record<string, string>,
    ): Promise<DashboardWorkspaceArtifactResponse>;
  listWorkspaceArtifactFiles(workspaceId: string): Promise<DashboardWorkspaceArtifactFileRecord[]>;
  downloadWorkspaceArtifactFile(
      workspaceId: string,
      fileId: string,
    ): Promise<DashboardWorkspaceArtifactFileDownload>;
  uploadWorkspaceArtifactFiles(
      workspaceId: string,
      payload: DashboardWorkspaceArtifactFileUploadInput[],
    ): Promise<DashboardWorkspaceArtifactFileRecord[]>;
  deleteWorkspaceArtifactFile(workspaceId: string, fileId: string): Promise<void>;
  updateWorkspaceSpec(
      workspaceId: string,
      payload: Record<string, unknown>,
    ): Promise<DashboardWorkspaceSpecRecord>;
  listWorkspaceResources(
      workspaceId: string,
    ): Promise<{ data: DashboardWorkspaceResourceRecord[] }>;
  listWorkspaceTools(workspaceId: string): Promise<{ data: DashboardWorkspaceToolCatalog }>;
  patchWorkspaceMemory(
      workspaceId: string,
      payload: { key: string; value: unknown },
    ): Promise<DashboardWorkspaceRecord>;
  removeWorkspaceMemory(workspaceId: string, key: string): Promise<DashboardWorkspaceRecord>;
  configureGitWebhook(
      workspaceId: string,
      payload: { provider: string; secret: string },
    ): Promise<Record<string, unknown>>;
  getWorkflow(id: string): Promise<DashboardWorkflowRecord>;
  getWorkflowRail(input?: {
      mode?: DashboardWorkflowRailMode;
      page?: number;
      perPage?: number;
      needsActionOnly?: boolean;
      lifecycleFilter?: 'all' | 'ongoing' | 'planned';
      playbookId?: string;
      updatedWithin?: 'all' | '24h' | '7d' | '30d';
      search?: string;
      workflowId?: string;
    }): Promise<DashboardWorkflowRailPacket>;
  getWorkflowWorkspace(
      workflowId: string,
      input?: {
        workItemId?: string;
        taskId?: string;
        tabScope?: 'workflow' | 'selected_work_item' | 'selected_task';
        liveConsoleLimit?: number;
        historyLimit?: number;
        deliverablesLimit?: number;
        boardMode?: string;
        boardFilters?: string;
        liveConsoleAfter?: string;
        historyAfter?: string;
        deliverablesAfter?: string;
      },
    ): Promise<DashboardWorkflowWorkspacePacket>;
  getAgenticSettings(): Promise<DashboardAgenticSettingsRecord>;
  updateAgenticSettings(
      payload: DashboardAgenticSettingsPatchInput,
    ): Promise<DashboardAgenticSettingsRecord>;
  getWorkflowSettings(workflowId: string): Promise<DashboardWorkflowSettingsRecord>;
  updateWorkflowSettings(
      workflowId: string,
      payload: DashboardWorkflowSettingsPatchInput,
    ): Promise<DashboardWorkflowSettingsRecord>;
  getMissionControlLive(input?: {
      page?: number;
      perPage?: number;
    }): Promise<DashboardMissionControlLiveResponse>;
  getMissionControlRecent(input?: {
      limit?: number;
    }): Promise<DashboardMissionControlRecentResponse>;
  getMissionControlHistory(input?: {
      workflowId?: string;
      limit?: number;
    }): Promise<DashboardMissionControlHistoryResponse>;
  getMissionControlWorkflowWorkspace(
      workflowId: string,
      input?: {
        historyLimit?: number;
        outputLimit?: number;
      },
    ): Promise<DashboardMissionControlWorkspaceResponse>;
  listWorkflowInputPackets(workflowId: string): Promise<DashboardWorkflowInputPacketRecord[]>;
  createWorkflowInputPacket(
      workflowId: string,
      payload: DashboardWorkflowInputPacketCreateInput,
    ): Promise<DashboardWorkflowInputPacketRecord>;
  listWorkflowInterventions(workflowId: string): Promise<DashboardWorkflowInterventionRecord[]>;
  createWorkflowIntervention(
      workflowId: string,
      payload: DashboardWorkflowInterventionCreateInput,
    ): Promise<DashboardWorkflowInterventionRecord>;
  listWorkflowSteeringSessions(workflowId: string): Promise<DashboardWorkflowSteeringSessionRecord[]>;
  createWorkflowSteeringSession(
      workflowId: string,
      payload?: DashboardWorkflowSteeringSessionCreateInput,
    ): Promise<DashboardWorkflowSteeringSessionRecord>;
  listWorkflowSteeringMessages(
      workflowId: string,
      sessionId: string,
    ): Promise<DashboardWorkflowSteeringMessageRecord[]>;
  createWorkflowSteeringRequest(
      workflowId: string,
      payload: DashboardWorkflowSteeringRequestInput,
    ): Promise<DashboardWorkflowSteeringRequestResult>;
  appendWorkflowSteeringMessage(
      workflowId: string,
      sessionId: string,
      payload: DashboardWorkflowSteeringMessageCreateInput,
    ): Promise<DashboardWorkflowSteeringMessageRecord>;
  redriveWorkflow(
      workflowId: string,
      payload: DashboardWorkflowRedriveInput,
    ): Promise<DashboardWorkflowRedriveResult>;
  getWorkflowBudget(workflowId: string): Promise<DashboardWorkflowBudgetRecord>;
  getWorkflowBoard(workflowId: string): Promise<DashboardWorkflowBoardResponse>;
  listWorkflowStages(workflowId: string): Promise<DashboardWorkflowStageRecord[]>;
  listWorkflowEvents(
      workflowId: string,
      filters?: Record<string, string>,
    ): Promise<DashboardEventPage>;
  listWorkflowWorkItems(workflowId: string): Promise<DashboardWorkflowWorkItemRecord[]>;
  getWorkflowWorkItem(
      workflowId: string,
      workItemId: string,
    ): Promise<DashboardWorkflowWorkItemRecord>;
  listWorkflowWorkItemTasks(
      workflowId: string,
      workItemId: string,
    ): Promise<Record<string, unknown>[]>;
  listWorkflowWorkItemEvents(
      workflowId: string,
      workItemId: string,
      limit?: number,
    ): Promise<DashboardEventRecord[]>;
  listWorkflowWorkItemHandoffs(
      workflowId: string,
      workItemId: string,
    ): Promise<DashboardTaskHandoffRecord[]>;
  getLatestWorkflowWorkItemHandoff(
      workflowId: string,
      workItemId: string,
    ): Promise<DashboardTaskHandoffRecord | null>;
  getWorkflowWorkItemMemory(
      workflowId: string,
      workItemId: string,
    ): Promise<{ entries: DashboardWorkItemMemoryEntry[] }>;
  getWorkflowWorkItemMemoryHistory(
      workflowId: string,
      workItemId: string,
      limit?: number,
    ): Promise<{ history: DashboardWorkItemMemoryHistoryEntry[] }>;
  listWorkflowActivations(workflowId: string): Promise<DashboardWorkflowActivationRecord[]>;
  enqueueWorkflowActivation(
      workflowId: string,
      payload: DashboardWorkflowActivationEnqueueInput,
    ): Promise<DashboardWorkflowActivationRecord>;
  listWorkflowDocuments(workflowId: string): Promise<DashboardResolvedDocumentReference[]>;
  createWorkflowDocument(
      workflowId: string,
      payload: DashboardWorkflowDocumentCreateInput,
    ): Promise<DashboardResolvedDocumentReference>;
  updateWorkflowDocument(
      workflowId: string,
      logicalName: string,
      payload: DashboardWorkflowDocumentUpdateInput,
    ): Promise<DashboardResolvedDocumentReference>;
  deleteWorkflowDocument(workflowId: string, logicalName: string): Promise<void>;
  listPlaybooks(): Promise<{ data: DashboardPlaybookRecord[] }>;
  getPlaybook(playbookId: string): Promise<DashboardPlaybookRecord>;
  createPlaybook(payload: {
      name: string;
      slug?: string;
      description?: string;
      outcome: string;
      lifecycle?: 'planned' | 'ongoing';
      definition: Record<string, unknown>;
    }): Promise<DashboardPlaybookRecord>;
  updatePlaybook(
      playbookId: string,
      payload: {
        name: string;
        slug?: string;
        description?: string;
        outcome: string;
        lifecycle?: 'planned' | 'ongoing';
        definition: Record<string, unknown>;
      },
    ): Promise<DashboardPlaybookRecord>;
  archivePlaybook(playbookId: string): Promise<DashboardPlaybookRecord>;
  restorePlaybook(playbookId: string): Promise<DashboardPlaybookRecord>;
  deletePlaybook(playbookId: string): Promise<void>;
  getPlaybookDeleteImpact(playbookId: string): Promise<DashboardPlaybookDeleteImpact>;
  deletePlaybookPermanently(playbookId: string): Promise<void>;
  listToolTags(): Promise<DashboardToolTagRecord[]>;
  createToolTag(payload: DashboardToolTagCreateInput): Promise<DashboardToolTagRecord>;
  updateToolTag(
      toolId: string,
      payload: DashboardToolTagUpdateInput,
    ): Promise<DashboardToolTagRecord>;
  deleteToolTag(toolId: string): Promise<void>;
  listRuntimeDefaults(): Promise<DashboardRuntimeDefaultRecord[]>;
  upsertRuntimeDefault(input: DashboardRuntimeDefaultUpsertInput): Promise<void>;
  deleteRuntimeDefault(id: string): Promise<void>;
  listExecutionEnvironmentCatalog(): Promise<DashboardExecutionEnvironmentCatalogRecord[]>;
  listExecutionEnvironments(): Promise<DashboardExecutionEnvironmentRecord[]>;
  createExecutionEnvironment(
      payload: DashboardExecutionEnvironmentCreateInput,
    ): Promise<DashboardExecutionEnvironmentRecord>;
  createExecutionEnvironmentFromCatalog(
      payload: DashboardExecutionEnvironmentCreateFromCatalogInput,
    ): Promise<DashboardExecutionEnvironmentRecord>;
  updateExecutionEnvironment(
      environmentId: string,
      payload: DashboardExecutionEnvironmentUpdateInput,
    ): Promise<DashboardExecutionEnvironmentRecord>;
  verifyExecutionEnvironment(environmentId: string): Promise<DashboardExecutionEnvironmentRecord>;
  setDefaultExecutionEnvironment(
      environmentId: string,
    ): Promise<DashboardExecutionEnvironmentRecord>;
  archiveExecutionEnvironment(environmentId: string): Promise<DashboardExecutionEnvironmentRecord>;
  restoreExecutionEnvironment(environmentId: string): Promise<DashboardExecutionEnvironmentRecord>;
  listRemoteMcpOAuthClientProfiles(): Promise<DashboardRemoteMcpOAuthClientProfileRecord[]>;
  getRemoteMcpOAuthClientProfile(profileId: string): Promise<DashboardRemoteMcpOAuthClientProfileRecord>;
  createRemoteMcpOAuthClientProfile(
      payload: DashboardRemoteMcpOAuthClientProfileCreateInput,
    ): Promise<DashboardRemoteMcpOAuthClientProfileRecord>;
  updateRemoteMcpOAuthClientProfile(
      profileId: string,
      payload: DashboardRemoteMcpOAuthClientProfileUpdateInput,
    ): Promise<DashboardRemoteMcpOAuthClientProfileRecord>;
}
