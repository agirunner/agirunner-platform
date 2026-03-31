import type { ApiListResponse } from '@agirunner/sdk';
import type {
  DashboardAgentRecord,
  DashboardWorkflowBudgetInput,
  DashboardLlmProviderRecord,
  DashboardLlmModelRecord,
  DashboardRemoteMcpServerRecord,
  DashboardRemoteMcpServerCreateInput,
  DashboardRemoteMcpServerUpdateInput,
  DashboardRemoteMcpAuthorizeResult,
  DashboardSpecialistSkillRecord,
  DashboardSpecialistSkillCreateInput,
  DashboardSpecialistSkillUpdateInput,
  DashboardRoleDefinitionRecord,
  DashboardLlmSystemDefaultRecord,
  DashboardLlmAssignmentRecord,
  DashboardLlmProviderCreateInput,
  DashboardOAuthProfileRecord,
  DashboardOAuthStatusRecord,
  DashboardWorkflowWorkItemRecord,
  DashboardWorkflowRecord,
  DashboardWorkspaceTimelineEntry,
  DashboardTaskRecord,
  DashboardCostSummaryRecord,
  DashboardGovernanceRetentionPolicy,
  DashboardLoggingConfig,
  DashboardTaskArtifactRecord,
  DashboardTaskArtifactContent,
  DashboardTaskArtifactDownload,
  DashboardTaskArtifactUploadInput,
} from '../models.js';
export interface DashboardApiMethodsPart2 {
  deleteRemoteMcpOAuthClientProfile(profileId: string): Promise<void>;
  listRemoteMcpServers(): Promise<DashboardRemoteMcpServerRecord[]>;
  getRemoteMcpServer(serverId: string): Promise<DashboardRemoteMcpServerRecord>;
  createRemoteMcpServer(
      payload: DashboardRemoteMcpServerCreateInput,
    ): Promise<DashboardRemoteMcpServerRecord>;
  updateRemoteMcpServer(
      serverId: string,
      payload: DashboardRemoteMcpServerUpdateInput,
    ): Promise<DashboardRemoteMcpServerRecord>;
  initiateRemoteMcpOAuthAuthorization(
      payload: DashboardRemoteMcpServerCreateInput,
    ): Promise<DashboardRemoteMcpAuthorizeResult>;
  reconnectRemoteMcpOAuth(serverId: string): Promise<DashboardRemoteMcpAuthorizeResult>;
  pollRemoteMcpOAuthDeviceAuthorization(deviceFlowId: string): Promise<DashboardRemoteMcpAuthorizeResult>;
  disconnectRemoteMcpOAuth(serverId: string): Promise<void>;
  reverifyRemoteMcpServer(serverId: string): Promise<DashboardRemoteMcpServerRecord>;
  deleteRemoteMcpServer(serverId: string): Promise<void>;
  listSpecialistSkills(): Promise<DashboardSpecialistSkillRecord[]>;
  getSpecialistSkill(skillId: string): Promise<DashboardSpecialistSkillRecord>;
  createSpecialistSkill(
      payload: DashboardSpecialistSkillCreateInput,
    ): Promise<DashboardSpecialistSkillRecord>;
  updateSpecialistSkill(
      skillId: string,
      payload: DashboardSpecialistSkillUpdateInput,
    ): Promise<DashboardSpecialistSkillRecord>;
  deleteSpecialistSkill(skillId: string): Promise<void>;
  saveRoleDefinition(
      roleId: string | null,
      payload: Record<string, unknown>,
    ): Promise<DashboardRoleDefinitionRecord>;
  deleteRoleDefinition(roleId: string): Promise<void>;
  getLlmSystemDefault(): Promise<DashboardLlmSystemDefaultRecord>;
  updateLlmSystemDefault(payload: DashboardLlmSystemDefaultRecord): Promise<void>;
  listLlmAssignments(): Promise<DashboardLlmAssignmentRecord[]>;
  updateLlmAssignment(
      roleName: string,
      payload: { primaryModelId?: string; reasoningConfig?: Record<string, unknown> | null },
    ): Promise<void>;
  createLlmProvider(payload: DashboardLlmProviderCreateInput): Promise<DashboardLlmProviderRecord>;
  deleteLlmProvider(providerId: string): Promise<void>;
  discoverLlmModels(providerId: string): Promise<unknown[]>;
  updateLlmModel(modelId: string, payload: Record<string, unknown>): Promise<void>;
  listOAuthProfiles(): Promise<DashboardOAuthProfileRecord[]>;
  initiateOAuthFlow(profileId: string): Promise<{ authorizeUrl: string }>;
  getOAuthProviderStatus(providerId: string): Promise<DashboardOAuthStatusRecord>;
  disconnectOAuthProvider(providerId: string): Promise<void>;
  listLlmProviders(): Promise<DashboardLlmProviderRecord[]>;
  listLlmModels(): Promise<DashboardLlmModelRecord[]>;
  createWorkflow(payload: {
      playbook_id: string;
      name: string;
      workspace_id?: string;
      parameters?: Record<string, string>;
      initial_input_packet?: {
        summary?: string;
        files?: Array<{
          file_name: string;
          description?: string;
          content_base64: string;
          content_type?: string;
        }>;
      };
      metadata?: Record<string, unknown>;
      config_overrides?: Record<string, unknown>;
      instruction_config?: Record<string, unknown>;
      budget?: DashboardWorkflowBudgetInput;
    }): Promise<DashboardWorkflowRecord>;
  createWorkflowWorkItem(
      workflowId: string,
      payload: {
        request_id?: string;
        parent_work_item_id?: string;
        stage_name?: string;
        title: string;
        goal?: string;
        acceptance_criteria?: string;
        column_id?: string;
        owner_role?: string;
        priority?: 'critical' | 'high' | 'normal' | 'low';
        notes?: string;
        metadata?: Record<string, unknown>;
        initial_input_packet?: {
          summary?: string;
          structured_inputs?: Record<string, unknown>;
          files?: Array<{
            file_name: string;
            description?: string;
            content_base64: string;
            content_type?: string;
          }>;
        };
      },
    ): Promise<DashboardWorkflowWorkItemRecord>;
  updateWorkflowWorkItem(
      workflowId: string,
      workItemId: string,
      payload: {
        parent_work_item_id?: string | null;
        title?: string;
        goal?: string;
        acceptance_criteria?: string;
        stage_name?: string;
        column_id?: string;
        owner_role?: string | null;
        priority?: 'critical' | 'high' | 'normal' | 'low';
        notes?: string | null;
        metadata?: Record<string, unknown>;
      },
    ): Promise<DashboardWorkflowWorkItemRecord>;
  retryWorkflowWorkItem(
      workflowId: string,
      workItemId: string,
      payload?: { override_input?: Record<string, unknown>; force?: boolean },
    ): Promise<unknown>;
  skipWorkflowWorkItem(
      workflowId: string,
      workItemId: string,
      payload: { reason: string },
    ): Promise<unknown>;
  reassignWorkflowWorkItemTask(
      workflowId: string,
      workItemId: string,
      taskId: string,
      payload: {
        request_id?: string;
        preferred_agent_id?: string;
        preferred_worker_id?: string;
        reason: string;
      },
    ): Promise<unknown>;
  approveWorkflowWorkItemTask(
      workflowId: string,
      workItemId: string,
      taskId: string,
    ): Promise<unknown>;
  approveWorkflowWorkItemTaskOutput(
      workflowId: string,
      workItemId: string,
      taskId: string,
    ): Promise<unknown>;
  rejectWorkflowWorkItemTask(
      workflowId: string,
      workItemId: string,
      taskId: string,
      payload: { feedback: string },
    ): Promise<unknown>;
  requestWorkflowWorkItemTaskChanges(
      workflowId: string,
      workItemId: string,
      taskId: string,
      payload: {
        feedback: string;
        override_input?: Record<string, unknown>;
        preferred_agent_id?: string;
        preferred_worker_id?: string;
      },
    ): Promise<unknown>;
  retryWorkflowWorkItemTask(
      workflowId: string,
      workItemId: string,
      taskId: string,
      payload?: { override_input?: Record<string, unknown>; force?: boolean },
    ): Promise<unknown>;
  skipWorkflowWorkItemTask(
      workflowId: string,
      workItemId: string,
      taskId: string,
      payload: { reason: string },
    ): Promise<unknown>;
  resolveWorkflowWorkItemTaskEscalation(
      workflowId: string,
      workItemId: string,
      taskId: string,
      payload: { instructions: string; context?: Record<string, unknown> },
    ): Promise<unknown>;
  cancelWorkflowWorkItemTask(
      workflowId: string,
      workItemId: string,
      taskId: string,
    ): Promise<unknown>;
  overrideWorkflowWorkItemTaskOutput(
      workflowId: string,
      workItemId: string,
      taskId: string,
      payload: { output: unknown; reason: string },
    ): Promise<unknown>;
  pauseWorkflowWorkItem(workflowId: string, workItemId: string): Promise<unknown>;
  resumeWorkflowWorkItem(workflowId: string, workItemId: string): Promise<unknown>;
  cancelWorkflowWorkItem(workflowId: string, workItemId: string): Promise<unknown>;
  cancelWorkflow(workflowId: string): Promise<unknown>;
  chainWorkflow(
      workflowId: string,
      payload: {
        playbook_id: string;
        name?: string;
        parameters?: Record<string, string>;
      },
    ): Promise<unknown>;
  listTasks(filters?: Record<string, string>): Promise<ApiListResponse<DashboardTaskRecord>>;
  getTask(id: string): Promise<DashboardTaskRecord>;
  listTaskArtifacts(taskId: string): Promise<DashboardTaskArtifactRecord[]>;
  uploadTaskArtifact(
      taskId: string,
      payload: DashboardTaskArtifactUploadInput,
    ): Promise<DashboardTaskArtifactRecord>;
  readTaskArtifactContent(
      taskId: string,
      artifactId: string,
    ): Promise<DashboardTaskArtifactContent>;
  downloadTaskArtifact(taskId: string, artifactId: string): Promise<DashboardTaskArtifactDownload>;
  readBinaryContentByHref(href: string): Promise<DashboardTaskArtifactContent>;
  downloadBinaryByHref(href: string): Promise<DashboardTaskArtifactDownload>;
  deleteTaskArtifact(taskId: string, artifactId: string): Promise<void>;
  listWorkers(): Promise<unknown>;
  listAgents(): Promise<DashboardAgentRecord[]>;
  approveTask(taskId: string): Promise<unknown>;
  approveTaskOutput(taskId: string): Promise<unknown>;
  retryTask(
      taskId: string,
      payload?: { override_input?: Record<string, unknown>; force?: boolean },
    ): Promise<unknown>;
  cancelTask(taskId: string): Promise<unknown>;
  rejectTask(taskId: string, payload: { feedback: string }): Promise<unknown>;
  requestTaskChanges(
      taskId: string,
      payload: {
        feedback: string;
        override_input?: Record<string, unknown>;
        preferred_agent_id?: string;
        preferred_worker_id?: string;
      },
    ): Promise<unknown>;
  skipTask(taskId: string, payload: { reason: string }): Promise<unknown>;
  reassignTask(
      taskId: string,
      payload: { preferred_agent_id?: string; preferred_worker_id?: string; reason: string },
    ): Promise<unknown>;
  escalateTask(
      taskId: string,
      payload: { reason: string; escalation_target?: string },
    ): Promise<unknown>;
  resolveEscalation(
      taskId: string,
      payload: { instructions: string; context?: Record<string, unknown> },
    ): Promise<unknown>;
  resolveTaskEscalation(
      taskId: string,
      payload: { instructions: string; context?: Record<string, unknown> },
      options?: { workflowId?: string | null; workItemId?: string | null },
    ): Promise<unknown>;
  actOnWorkflowGate(
      workflowId: string,
      gateId: string,
      payload: { action: 'approve' | 'reject' | 'request_changes' | 'block'; feedback?: string },
    ): Promise<unknown>;
  overrideTaskOutput(
      taskId: string,
      payload: { output: unknown; reason: string },
    ): Promise<unknown>;
  pauseWorkflow(workflowId: string): Promise<unknown>;
  resumeWorkflow(workflowId: string): Promise<unknown>;
  getWorkspaceTimeline(workspaceId: string): Promise<DashboardWorkspaceTimelineEntry[]>;
  createPlanningWorkflow(
      workspaceId: string,
      payload: { brief: string; name?: string },
    ): Promise<unknown>;
  listRoleDefinitions(): Promise<DashboardRoleDefinitionRecord[]>;
  getCostSummary(): Promise<DashboardCostSummaryRecord>;
  getRetentionPolicy(): Promise<DashboardGovernanceRetentionPolicy>;
  updateRetentionPolicy(
      payload: Partial<DashboardGovernanceRetentionPolicy>,
    ): Promise<DashboardGovernanceRetentionPolicy>;
  getLoggingConfig(): Promise<DashboardLoggingConfig>;
}
