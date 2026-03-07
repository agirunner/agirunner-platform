import { PlatformApiClient } from '@agentbaton/sdk';

import { clearSession, readSession, writeSession } from './session.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

interface DashboardApiOptions {
  baseUrl?: string;
  client?: PlatformApiClient;
  fetcher?: typeof fetch;
}

interface NamedRecord {
  id: string;
  name?: string;
  title?: string;
  state?: string;
  status?: string;
}

export interface DashboardSearchResult {
  type: 'pipeline' | 'task' | 'worker' | 'agent';
  id: string;
  label: string;
  subtitle: string;
  href: string;
}

export interface DashboardTemplate {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  version: number;
  is_built_in: boolean;
  is_published: boolean;
  schema: Record<string, unknown>;
}

export interface DashboardEventRecord {
  id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  actor_type: string;
  actor_id?: string | null;
  data?: Record<string, unknown>;
  created_at: string;
}

export interface DashboardApiKeyRecord {
  id: string;
  scope: string;
  owner_type: string;
  owner_id: string | null;
  label: string | null;
  key_prefix: string;
  last_used_at: string | null;
  expires_at: string;
  is_revoked: boolean;
  created_at: string;
}

export interface DashboardPipelinePhaseActionPayload {
  action: 'approve' | 'reject' | 'request_changes';
  feedback?: string;
  override_input?: Record<string, unknown>;
}

export interface DashboardResolvedConfigResponse {
  pipeline_id: string;
  resolved_config: Record<string, unknown>;
  config_layers?: Record<string, Record<string, unknown>>;
}

export interface DashboardProjectTimelineEntry {
  kind?: string;
  pipeline_id: string;
  name: string;
  state: string;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  duration_seconds?: number | null;
  task_counts?: Record<string, unknown>;
  phase_progression?: Array<Record<string, unknown>>;
  phase_metrics?: Array<Record<string, unknown>>;
  produced_artifacts?: Array<Record<string, unknown>>;
  chain?: Record<string, unknown>;
  link?: string;
}

export interface DashboardProjectRecord {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  repository_url?: string | null;
  is_active?: boolean;
  memory?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface DashboardResolvedDocumentReference {
  logical_name: string;
  scope: 'project' | 'pipeline';
  source: 'repository' | 'artifact' | 'external';
  title?: string;
  description?: string;
  metadata: Record<string, unknown>;
  created_at?: string;
  task_id?: string;
  repository?: string;
  path?: string;
  url?: string;
  artifact?: {
    id: string;
    task_id: string;
    logical_path: string;
    content_type?: string;
    download_url: string;
  };
}

export interface DashboardTaskArtifactRecord {
  id: string;
  pipeline_id?: string | null;
  project_id?: string | null;
  task_id: string;
  logical_path: string;
  content_type: string;
  size_bytes: number;
  checksum_sha256: string;
  metadata: Record<string, unknown>;
  retention_policy: Record<string, unknown>;
  expires_at?: string | null;
  created_at: string;
  download_url: string;
  access_url?: string | null;
  access_url_expires_at?: string | null;
  storage_backend?: string;
}

export interface DashboardCustomizationManagedFile {
  source: string;
  target: string;
}

export interface DashboardCustomizationSetupScript {
  path: string;
  sha256: string;
}

export interface DashboardCustomizationReasoning {
  orchestrator_level?: 'low' | 'medium' | 'high';
  internal_workers_level?: 'low' | 'medium' | 'high';
}

export interface DashboardCustomizationManifest {
  template: string;
  base_image: string;
  customizations?: {
    apt?: string[];
    npm_global?: string[];
    pip?: string[];
    files?: DashboardCustomizationManagedFile[];
    setup_script?: DashboardCustomizationSetupScript;
  };
  reasoning?: DashboardCustomizationReasoning;
}

export interface DashboardCustomizationValidationError {
  field_path: string;
  rule_id: string;
  message: string;
  remediation: string;
}

export interface DashboardCustomizationValidateResponse {
  valid: boolean;
  manifest: DashboardCustomizationManifest;
  errors?: DashboardCustomizationValidationError[];
}

export interface DashboardCustomizationGate {
  name: string;
  status: string;
  message?: string;
}

export interface DashboardCustomizationWaiver {
  gate: string;
  scope?: string;
  environment?: string;
  reason?: string;
  ticket?: string;
  approved_by?: string[];
  expires_at?: string;
}

export interface DashboardCustomizationBuildInputs {
  template_version?: string;
  policy_bundle_version?: string;
  lock_digests?: Record<string, string>;
  build_args?: Record<string, string>;
  secret_refs?: Array<{ id: string; version: string }>;
}

export interface DashboardCustomizationTrustPolicy {
  environment?: string;
}

export interface DashboardCustomizationTrustEvidence {
  vulnerability?: {
    critical_findings?: number;
    high_findings?: number;
  };
  sbom?: {
    format?: string;
    digest?: string;
  };
  provenance?: {
    verified?: boolean;
    source_revision?: string;
    builder_id?: string;
    ciih?: string;
    digest?: string;
  };
  signature?: {
    verified?: boolean;
    trusted_identity?: string;
  };
}

export interface DashboardCustomizationBuildResponse {
  build_id?: string;
  state: string;
  ciih?: string;
  digest?: string;
  manifest: DashboardCustomizationManifest;
  inputs?: DashboardCustomizationBuildInputs;
  trust_policy?: DashboardCustomizationTrustPolicy;
  gates?: DashboardCustomizationGate[];
  waivers?: DashboardCustomizationWaiver[];
  auto_link_requested?: boolean;
  link_ready: boolean;
  link_blocked_reason?: string;
  reused?: boolean;
  errors?: DashboardCustomizationValidationError[];
  error?: string;
}

export interface DashboardCustomizationStatusResponse {
  state: string;
  customization_enabled: boolean;
  configured_digest?: string;
  active_digest?: string;
  pending_rollout_digest?: string;
  resolved_reasoning: DashboardCustomizationReasoning;
}

export interface DashboardCustomizationLinkResponse {
  build_id?: string;
  state: string;
  ciih?: string;
  digest?: string;
  gates?: DashboardCustomizationGate[];
  linked: boolean;
  configured_digest?: string;
  active_digest?: string;
  link_blocked_reason?: string;
  reused?: boolean;
  error?: string;
}

export interface DashboardCustomizationRollbackResponse {
  current_build_id?: string;
  target_build_id?: string;
  state: string;
  current_digest?: string;
  target_digest?: string;
  previous_digest?: string;
  configured_digest?: string;
  active_digest?: string;
  target_gates?: DashboardCustomizationGate[];
  rolled_back: boolean;
  rollback_blocked_reason?: string;
  error?: string;
}

export interface DashboardCustomizationProfile {
  profile_id?: string;
  name?: string;
  scope?: string;
  manifest_checksum?: string;
  latest_gated_digest?: string;
  created_by?: string;
  updated_at?: string;
  inference_metadata?: Record<string, string>;
  manifest: DashboardCustomizationManifest;
}

export interface DashboardCustomizationInspectResponse {
  state: string;
  manifest: DashboardCustomizationManifest;
  profile: DashboardCustomizationProfile;
  field_confidence?: Record<string, string>;
  non_inferable_fields?: string[];
}

export interface DashboardCustomizationExportResponse {
  artifact_type?: string;
  format?: string;
  path?: string;
  checksum?: string;
  content?: string;
  redaction_applied: boolean;
  scan_passed: boolean;
  findings?: Array<{ rule_id: string; location: string; message: string }>;
  error?: string;
}

export interface DashboardApi {
  login(apiKey: string): Promise<void>;
  logout(): Promise<void>;
  listPipelines(): Promise<unknown>;
  listProjects(): Promise<{ data: DashboardProjectRecord[]; meta?: Record<string, unknown> }>;
  getProject(projectId: string): Promise<DashboardProjectRecord>;
  patchProjectMemory(
    projectId: string,
    payload: { key: string; value: unknown },
  ): Promise<DashboardProjectRecord>;
  getPipeline(id: string): Promise<unknown>;
  listPipelineDocuments(pipelineId: string): Promise<DashboardResolvedDocumentReference[]>;
  listTemplates(): Promise<{ data: DashboardTemplate[]; meta?: Record<string, unknown> }>;
  createPipeline(payload: {
    template_id: string;
    name: string;
    parameters?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<unknown>;
  cancelPipeline(pipelineId: string): Promise<unknown>;
  listTasks(filters?: Record<string, string>): Promise<unknown>;
  getTask(id: string): Promise<unknown>;
  listTaskArtifacts(taskId: string): Promise<DashboardTaskArtifactRecord[]>;
  listWorkers(): Promise<unknown>;
  listAgents(): Promise<unknown>;
  approveTask(taskId: string): Promise<unknown>;
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
  overrideTaskOutput(
    taskId: string,
    payload: { output: unknown; reason: string },
  ): Promise<unknown>;
  pausePipeline(pipelineId: string): Promise<unknown>;
  resumePipeline(pipelineId: string): Promise<unknown>;
  manualReworkPipeline(pipelineId: string, payload: { feedback: string }): Promise<unknown>;
  actOnPhaseGate(
    pipelineId: string,
    phaseName: string,
    payload: DashboardPipelinePhaseActionPayload,
  ): Promise<unknown>;
  cancelPhase(pipelineId: string, phaseName: string): Promise<unknown>;
  getResolvedPipelineConfig(
    pipelineId: string,
    showLayers?: boolean,
  ): Promise<DashboardResolvedConfigResponse>;
  getProjectTimeline(projectId: string): Promise<DashboardProjectTimelineEntry[]>;
  createPlanningPipeline(
    projectId: string,
    payload: { brief: string; name?: string },
  ): Promise<unknown>;
  listEvents(
    filters?: Record<string, string>,
  ): Promise<{ data: DashboardEventRecord[]; meta?: Record<string, unknown> }>;
  listApiKeys(): Promise<DashboardApiKeyRecord[]>;
  createApiKey(payload: {
    scope: 'agent' | 'worker' | 'admin';
    owner_type: string;
    owner_id?: string;
    label?: string;
    expires_at: string;
  }): Promise<{ api_key: string; key_prefix: string }>;
  revokeApiKey(id: string): Promise<unknown>;
  search(query: string): Promise<DashboardSearchResult[]>;
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
}

export function createDashboardApi(options: DashboardApiOptions = {}): DashboardApi {
  const baseUrl = options.baseUrl ?? API_BASE_URL;
  const session = readSession();
  const client =
    options.client ??
    new PlatformApiClient({
      baseUrl,
      accessToken: session?.accessToken ?? undefined,
    });
  const requestFetch = options.fetcher ?? fetch;

  async function withRefresh<T>(handler: () => Promise<T>): Promise<T> {
    try {
      return await handler();
    } catch (error) {
      const message = String(error);
      if (!message.includes('HTTP 401')) {
        throw error;
      }

      const activeSession = readSession();
      if (!activeSession) {
        throw error;
      }

      try {
        const refreshed = await client.refreshSession();
        writeSession({
          accessToken: refreshed.token,
          tenantId: activeSession.tenantId,
        });
        client.setAccessToken(refreshed.token);
        return handler();
      } catch (refreshError) {
        clearSession();
        if (typeof window !== 'undefined') {
          window.location.assign('/login');
        }
        throw refreshError;
      }
    }
  }

  async function requestJson<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      body?: Record<string, unknown>;
      includeAuth?: boolean;
    } = {},
  ): Promise<T> {
    const activeSession = readSession();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if ((options.includeAuth ?? true) && activeSession?.accessToken) {
      headers.Authorization = `Bearer ${activeSession.accessToken}`;
    }

    const response = await requestFetch(`${baseUrl}${path}`, {
      method: options.method ?? 'POST',
      headers,
      credentials: 'include',
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  async function requestData<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      body?: Record<string, unknown>;
    } = {},
  ): Promise<T> {
    const response = await requestJson<{ data: T }>(path, options);
    return response.data;
  }

  return {
    async login(apiKey: string): Promise<void> {
      const auth = await client.exchangeApiKey(apiKey);
      writeSession({
        accessToken: auth.token,
        tenantId: auth.tenant_id,
      });
      client.setAccessToken(auth.token);
    },
    async logout(): Promise<void> {
      try {
        await requestJson('/api/v1/auth/logout', { method: 'POST' });
      } finally {
        clearSession();
      }
    },
    listPipelines: () => withRefresh(() => client.listPipelines()),
    listProjects: () =>
      withRefresh(
        () =>
          requestJson('/api/v1/projects?per_page=50', { method: 'GET' }) as Promise<{
            data: DashboardProjectRecord[];
            meta?: Record<string, unknown>;
          }>,
      ),
    getProject: (projectId) =>
      withRefresh(() =>
        requestData<DashboardProjectRecord>(`/api/v1/projects/${projectId}`, {
          method: 'GET',
        }),
      ),
    patchProjectMemory: (projectId, payload) =>
      withRefresh(() =>
        requestData<DashboardProjectRecord>(`/api/v1/projects/${projectId}/memory`, {
          method: 'PATCH',
          body: payload as Record<string, unknown>,
        }),
      ),
    getPipeline: (id) => withRefresh(() => client.getPipeline(id)),
    listPipelineDocuments: (pipelineId) =>
      withRefresh(() =>
        requestData<DashboardResolvedDocumentReference[]>(
          `/api/v1/pipelines/${pipelineId}/documents`,
          { method: 'GET' },
        ),
      ),
    listTemplates: () =>
      withRefresh(
        () =>
          requestJson('/api/v1/templates?per_page=50', { method: 'GET' }) as Promise<{
            data: DashboardTemplate[];
          }>,
      ),
    createPipeline: (payload) => withRefresh(() => client.createPipeline(payload)),
    cancelPipeline: (pipelineId) => withRefresh(() => client.cancelPipeline(pipelineId)),
    listTasks: (filters) => withRefresh(() => client.listTasks(filters)),
    getTask: (id) => withRefresh(() => client.getTask(id)),
    listTaskArtifacts: (taskId) =>
      withRefresh(() =>
        requestData<DashboardTaskArtifactRecord[]>(`/api/v1/tasks/${taskId}/artifacts`, {
          method: 'GET',
        }),
      ),
    listWorkers: () => withRefresh(() => client.listWorkers()),
    listAgents: () => withRefresh(() => client.listAgents()),
    approveTask: (taskId) => withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/approve`)),
    retryTask: (taskId, payload = {}) =>
      withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/retry`, { body: payload })),
    cancelTask: (taskId) => withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/cancel`)),
    rejectTask: (taskId, payload) =>
      withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/reject`, { body: payload })),
    requestTaskChanges: (taskId, payload) =>
      withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/request-changes`, { body: payload })),
    skipTask: (taskId, payload) =>
      withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/skip`, { body: payload })),
    reassignTask: (taskId, payload) =>
      withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/reassign`, { body: payload })),
    escalateTask: (taskId, payload) =>
      withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/escalate`, { body: payload })),
    overrideTaskOutput: (taskId, payload) =>
      withRefresh(() => requestJson(`/api/v1/tasks/${taskId}/output-override`, { body: payload })),
    pausePipeline: (pipelineId) =>
      withRefresh(() => requestJson(`/api/v1/pipelines/${pipelineId}/pause`)),
    resumePipeline: (pipelineId) =>
      withRefresh(() => requestJson(`/api/v1/pipelines/${pipelineId}/resume`)),
    manualReworkPipeline: (pipelineId, payload) =>
      withRefresh(() =>
        requestJson(`/api/v1/pipelines/${pipelineId}/manual-rework`, { body: payload }),
      ),
    actOnPhaseGate: (pipelineId, phaseName, payload) =>
      withRefresh(() =>
        requestJson(`/api/v1/pipelines/${pipelineId}/phases/${phaseName}/gate`, {
          body: payload as unknown as Record<string, unknown>,
        }),
      ),
    cancelPhase: (pipelineId, phaseName) =>
      withRefresh(() =>
        requestJson(`/api/v1/pipelines/${pipelineId}/phases/${phaseName}/cancel`),
      ),
    getResolvedPipelineConfig: (pipelineId, showLayers = false) =>
      withRefresh(() =>
        requestData<DashboardResolvedConfigResponse>(
          `/api/v1/pipelines/${pipelineId}/config/resolved${showLayers ? '?show_layers=true' : ''}`,
          { method: 'GET' },
        ),
      ),
    getProjectTimeline: (projectId) =>
      withRefresh(() =>
        requestData<DashboardProjectTimelineEntry[]>(`/api/v1/projects/${projectId}/timeline`, {
          method: 'GET',
        }),
      ),
    createPlanningPipeline: (projectId, payload) =>
      withRefresh(() =>
        requestJson(`/api/v1/projects/${projectId}/planning-pipeline`, {
          body: payload,
        }),
      ),
    listEvents: (filters) =>
      withRefresh(() =>
        requestJson<{ data: DashboardEventRecord[] }>(
          `/api/v1/events${buildQueryString(filters)}`,
          { method: 'GET' },
        ),
      ),
    listApiKeys: () =>
      withRefresh(async () => {
        const response = await requestJson<{ data: DashboardApiKeyRecord[] }>('/api/v1/api-keys', {
          method: 'GET',
        });
        return response.data;
      }),
    createApiKey: (payload) =>
      withRefresh(async () => {
        const response = await requestJson<{
          data: { api_key: string; key_prefix: string };
        }>('/api/v1/api-keys', { body: payload });
        return response.data;
      }),
    revokeApiKey: (id) =>
      withRefresh(() => requestJson(`/api/v1/api-keys/${id}`, { method: 'DELETE' })),
    search: (query) =>
      withRefresh(async () => {
        const normalizedQuery = query.trim().toLowerCase();
        if (normalizedQuery.length < 2) {
          return [];
        }

        const [pipelines, tasks, workers, agents] = await Promise.allSettled([
          client.listPipelines({ per_page: 50 }),
          client.listTasks({ per_page: 50 }),
          client.listWorkers(),
          client.listAgents(),
        ]);

        return buildSearchResults(normalizedQuery, {
          pipelines: extractListResult(pipelines),
          tasks: extractListResult(tasks),
          workers: extractDataResult(workers),
          agents: extractDataResult(agents),
        });
      }),
    getMetrics: () =>
      withRefresh(async () => {
        const activeSession = readSession();
        const headers = activeSession?.accessToken
          ? {
              Authorization: `Bearer ${activeSession.accessToken}`,
            }
          : undefined;

        const response = await requestFetch(`${baseUrl}/metrics`, {
          headers,
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return response.text();
      }),
    getCustomizationStatus: () =>
      withRefresh(() =>
        requestData<DashboardCustomizationStatusResponse>('/api/v1/runtime/customizations/status', {
          method: 'GET',
        }),
      ),
    validateCustomization: (payload) =>
      withRefresh(() =>
        requestData<DashboardCustomizationValidateResponse>(
          '/api/v1/runtime/customizations/validate',
          { body: payload },
        ),
      ),
    createCustomizationBuild: (payload) =>
      withRefresh(() =>
        requestData<DashboardCustomizationBuildResponse>('/api/v1/runtime/customizations/builds', {
          body: payload,
        }),
      ),
    getCustomizationBuild: (id) =>
      withRefresh(() =>
        requestData<DashboardCustomizationBuildResponse>(
          `/api/v1/runtime/customizations/builds/${id}`,
          { method: 'GET' },
        ),
      ),
    linkCustomizationBuild: (payload) =>
      withRefresh(() =>
        requestData<DashboardCustomizationLinkResponse>('/api/v1/runtime/customizations/links', {
          body: payload,
        }),
      ),
    rollbackCustomizationBuild: (payload) =>
      withRefresh(() =>
        requestData<DashboardCustomizationRollbackResponse>(
          '/api/v1/runtime/customizations/rollback',
          { body: payload },
        ),
      ),
    reconstructCustomization: () =>
      withRefresh(() =>
        requestData<DashboardCustomizationInspectResponse>(
          '/api/v1/runtime/customizations/reconstruct',
          { body: {} },
        ),
      ),
    exportCustomization: (payload) =>
      withRefresh(() =>
        requestData<DashboardCustomizationExportResponse>(
          '/api/v1/runtime/customizations/reconstruct/export',
          { body: payload },
        ),
      ),
  };
}

function buildQueryString(filters?: Record<string, string>): string {
  if (!filters) {
    return '';
  }

  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });

  const rendered = params.toString();
  return rendered.length > 0 ? `?${rendered}` : '';
}

export function buildSearchResults(
  normalizedQuery: string,
  collections: {
    pipelines: NamedRecord[];
    tasks: NamedRecord[];
    workers: NamedRecord[];
    agents: NamedRecord[];
  },
): DashboardSearchResult[] {
  const pipelineMatches = filterRecords(collections.pipelines, normalizedQuery).map((item) => ({
    type: 'pipeline' as const,
    id: item.id,
    label: item.name ?? item.id,
    subtitle: item.state ?? 'pipeline',
    href: `/pipelines/${item.id}`,
  }));

  const taskMatches = filterRecords(collections.tasks, normalizedQuery).map((item) => ({
    type: 'task' as const,
    id: item.id,
    label: item.title ?? item.name ?? item.id,
    subtitle: item.state ?? 'task',
    href: `/tasks/${item.id}`,
  }));

  const workerMatches = filterRecords(collections.workers, normalizedQuery).map((item) => ({
    type: 'worker' as const,
    id: item.id,
    label: item.name ?? item.id,
    subtitle: item.status ?? 'worker',
    href: '/workers',
  }));

  const agentMatches = filterRecords(collections.agents, normalizedQuery).map((item) => ({
    type: 'agent' as const,
    id: item.id,
    label: item.name ?? item.id,
    subtitle: item.status ?? 'agent',
    href: '/workers',
  }));

  return [...pipelineMatches, ...taskMatches, ...workerMatches, ...agentMatches].slice(0, 12);
}

function filterRecords(records: NamedRecord[], query: string): NamedRecord[] {
  return records.filter((record) => {
    const haystack = `${record.id} ${record.name ?? ''} ${record.title ?? ''}`.toLowerCase();
    return haystack.includes(query);
  });
}

function extractListResult(result: PromiseSettledResult<unknown>): NamedRecord[] {
  if (result.status !== 'fulfilled') {
    return [];
  }

  const value = result.value as { data?: unknown };
  return Array.isArray(value.data) ? (value.data as NamedRecord[]) : [];
}

function extractDataResult(result: PromiseSettledResult<unknown>): NamedRecord[] {
  if (result.status !== 'fulfilled') {
    return [];
  }

  const value = result.value as { data?: unknown } | unknown[];
  if (Array.isArray(value)) {
    return value as NamedRecord[];
  }

  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: NamedRecord[] }).data;
  }

  return [];
}

export const dashboardApi = createDashboardApi();
