import { readSession } from '../../lib/session.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

export interface DashboardGateDetailRecord {
  id: string;
  gate_id: string;
  workflow_id: string;
  workflow_name?: string | null;
  stage_id?: string | null;
  stage_name: string;
  stage_goal?: string | null;
  status: string;
  gate_status: string;
  request_summary?: string | null;
  summary?: string | null;
  recommendation?: string | null;
  concerns: string[];
  key_artifacts: Array<Record<string, unknown>>;
  requested_by_type?: string | null;
  requested_by_id?: string | null;
  decided_by_type?: string | null;
  decided_by_id?: string | null;
  decision_feedback?: string | null;
  human_decision?: {
    action?: 'approve' | 'reject' | 'request_changes' | null;
    decided_by_type?: string | null;
    decided_by_id?: string | null;
    feedback?: string | null;
    decided_at?: string | null;
  } | null;
  decision_history?: Array<{
    action: 'requested' | 'approve' | 'reject' | 'request_changes' | string;
    actor_type?: string | null;
    actor_id?: string | null;
    feedback?: string | null;
    created_at?: string | null;
  }>;
  requested_by_task?: {
    id: string;
    title?: string | null;
    role?: string | null;
    work_item_id?: string | null;
    work_item_title?: string | null;
  } | null;
  orchestrator_resume?: {
    activation_id: string;
    state?: string | null;
    event_type?: string | null;
    reason?: string | null;
    queued_at?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
    summary?: string | null;
    error?: Record<string, unknown> | null;
    latest_event_at?: string | null;
    event_count?: number;
    task?: {
      id: string;
      title?: string | null;
      state?: string | null;
      started_at?: string | null;
      completed_at?: string | null;
    } | null;
  } | null;
  orchestrator_resume_history?: Array<{
    activation_id: string;
    state?: string | null;
    event_type?: string | null;
    reason?: string | null;
    queued_at?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
    summary?: string | null;
    error?: Record<string, unknown> | null;
    latest_event_at?: string | null;
    event_count?: number;
    task?: {
      id: string;
      title?: string | null;
      state?: string | null;
      started_at?: string | null;
      completed_at?: string | null;
    } | null;
  }>;
  requested_at: string;
  decided_at?: string | null;
  updated_at: string;
}

export interface GateDecisionPayload {
  action: 'approve' | 'reject' | 'request_changes';
  feedback?: string;
}

export async function listWorkflowGates(workflowId: string): Promise<DashboardGateDetailRecord[]> {
  return requestData<DashboardGateDetailRecord[]>(`/api/v1/workflows/${workflowId}/gates`, {
    method: 'GET',
  });
}

export async function getGateDetail(gateId: string): Promise<DashboardGateDetailRecord> {
  return requestData<DashboardGateDetailRecord>(`/api/v1/approvals/${gateId}`, {
    method: 'GET',
  });
}

export async function actOnGate(
  gateId: string,
  payload: GateDecisionPayload,
): Promise<DashboardGateDetailRecord> {
  return requestData<DashboardGateDetailRecord>(`/api/v1/approvals/${gateId}`, {
    method: 'POST',
    body: { ...payload },
  });
}

async function requestData<T>(
  path: string,
  options: {
    method: 'GET' | 'POST';
    body?: Record<string, unknown>;
  },
): Promise<T> {
  const session = readSession();
  const headers: Record<string, string> = {};
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }

  const response = await fetch(new URL(path, API_BASE_URL).toString(), {
    method: options.method,
    headers,
    credentials: 'include',
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { data: T };
  return payload.data;
}
