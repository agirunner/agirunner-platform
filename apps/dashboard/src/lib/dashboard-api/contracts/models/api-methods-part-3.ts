import type {
  DashboardSearchResult,
  DashboardDeleteImpactSummary,
  DashboardEventPage,
  DashboardApiKeyRecord,
  DashboardLoggingConfig,
  DashboardCustomizationManifest,
  DashboardCustomizationValidateResponse,
  DashboardCustomizationWaiver,
  DashboardCustomizationBuildInputs,
  DashboardCustomizationTrustPolicy,
  DashboardCustomizationTrustEvidence,
  DashboardCustomizationBuildResponse,
  DashboardCustomizationStatusResponse,
  DashboardCustomizationLinkResponse,
  DashboardCustomizationRollbackResponse,
  DashboardCustomizationInspectResponse,
  DashboardCustomizationExportResponse,
  FleetStatusResponse,
  FleetEventRecord,
  QueueDepthResponse,
  LogEntry,
  LogQueryResponse,
  LogStatsResponse,
  LogOperationRecord,
  LogOperationValueRecord,
  LogRoleRecord,
  LogRoleValueRecord,
  LogActorRecord,
  LogActorKindValueRecord,
  LogWorkflowValueRecord,
  FleetWorkerRecord,
  DashboardLiveContainerRecord,
} from '../models.js';
export interface DashboardApiMethodsPart3 {
  updateLoggingConfig(payload: DashboardLoggingConfig): Promise<DashboardLoggingConfig>;
  listEvents(filters?: Record<string, string>): Promise<DashboardEventPage>;
  listApiKeys(): Promise<DashboardApiKeyRecord[]>;
  createApiKey(payload: {
      scope: 'agent' | 'worker' | 'admin' | 'service';
      owner_type?: string;
      owner_id?: string;
      label?: string;
      expires_at?: string | null;
    }): Promise<{ api_key: string; key_prefix: string }>;
  revokeApiKey(id: string): Promise<unknown>;
  search(query: string): Promise<DashboardSearchResult[]>;
  fetchFleetStatus(): Promise<FleetStatusResponse>;
  fetchFleetEvents(
      filters?: Record<string, string>,
    ): Promise<{ data: FleetEventRecord[]; total: number }>;
  fetchFleetWorkers(): Promise<FleetWorkerRecord[]>;
  createFleetWorker(payload: {
      workerName: string;
      role: string;
      poolKind?: 'orchestrator' | 'specialist';
      runtimeImage: string;
      cpuLimit?: string;
      memoryLimit?: string;
      networkPolicy?: string;
      environment?: Record<string, unknown>;
      llmProvider?: string;
      llmModel?: string;
      llmApiKeySecretRef?: string;
      replicas?: number;
      enabled?: boolean;
    }): Promise<FleetWorkerRecord>;
  updateFleetWorker(
      workerId: string,
      payload: {
        role?: string;
        poolKind?: 'orchestrator' | 'specialist';
        runtimeImage?: string;
        cpuLimit?: string;
        memoryLimit?: string;
        networkPolicy?: string;
        environment?: Record<string, unknown>;
        llmProvider?: string;
        llmModel?: string;
        llmApiKeySecretRef?: string;
        replicas?: number;
        enabled?: boolean;
      },
    ): Promise<FleetWorkerRecord>;
  restartFleetWorker(workerId: string): Promise<unknown>;
  drainFleetWorker(workerId: string): Promise<unknown>;
  deleteFleetWorker(workerId: string): Promise<void>;
  fetchLiveContainers(): Promise<DashboardLiveContainerRecord[]>;
  fetchQueueDepth(playbookId?: string): Promise<QueueDepthResponse>;
  getMetrics(): Promise<string>;
  getCustomizationStatus(): Promise<DashboardCustomizationStatusResponse>;
  validateCustomization(payload: {
      manifest: DashboardCustomizationManifest;
    }): Promise<DashboardCustomizationValidateResponse>;
  createCustomizationBuild(payload: {
      manifest: DashboardCustomizationManifest;
      auto_link?: boolean;
      inputs?: DashboardCustomizationBuildInputs;
      trust_policy?: DashboardCustomizationTrustPolicy;
      trust_evidence?: DashboardCustomizationTrustEvidence;
      waivers?: DashboardCustomizationWaiver[];
    }): Promise<DashboardCustomizationBuildResponse>;
  getCustomizationBuild(id: string): Promise<DashboardCustomizationBuildResponse>;
  linkCustomizationBuild(payload: {
      build_id: string;
    }): Promise<DashboardCustomizationLinkResponse>;
  rollbackCustomizationBuild(payload: {
      current_build_id: string;
      target_build_id: string;
    }): Promise<DashboardCustomizationRollbackResponse>;
  reconstructCustomization(): Promise<DashboardCustomizationInspectResponse>;
  exportCustomization(payload: {
      artifact_type?: 'manifest' | 'profile' | 'template';
      format?: 'json' | 'yaml';
    }): Promise<DashboardCustomizationExportResponse>;
  queryLogs(filters: Record<string, string>): Promise<LogQueryResponse>;
  getLog(logId: string | number): Promise<{ data: LogEntry }>;
  getLogStats(filters: Record<string, string>): Promise<LogStatsResponse>;
  getLogOperations(filters?: Record<string, string>): Promise<{ data: LogOperationRecord[] }>;
  getLogRoles(filters?: Record<string, string>): Promise<{ data: LogRoleRecord[] }>;
  getLogActors(filters?: Record<string, string>): Promise<{ data: LogActorRecord[] }>;
  getLogOperationValues(
      filters?: Record<string, string>,
    ): Promise<{ data: LogOperationValueRecord[] }>;
  getLogRoleValues(filters?: Record<string, string>): Promise<{ data: LogRoleValueRecord[] }>;
  getLogActorKindValues(
      filters?: Record<string, string>,
    ): Promise<{ data: LogActorKindValueRecord[] }>;
  getLogWorkflowValues(
      filters?: Record<string, string>,
    ): Promise<{ data: LogWorkflowValueRecord[] }>;
  exportLogs(filters: Record<string, string>): Promise<Blob>;
  getWorkspaceDeleteImpact(workspaceId: string): Promise<DashboardDeleteImpactSummary>;
  deleteWorkspace(workspaceId: string, options?: { cascade?: boolean }): Promise<void>;
}
