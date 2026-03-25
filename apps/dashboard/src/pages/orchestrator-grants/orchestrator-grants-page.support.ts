import type { ComboboxItem } from '../../components/log-viewer/ui/searchable-combobox.js';
import type { DashboardAgentRecord, DashboardWorkflowRecord } from '../../lib/api.js';
import { readSession } from '../../lib/session.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

export const GRANT_PERMISSION_OPTIONS = ['read', 'write', 'execute'] as const;

export interface OrchestratorGrant {
  id: string;
  workflow_id: string;
  agent_id: string;
  permissions: string[];
  expires_at?: string | null;
  created_at: string;
}

export interface CreateGrantPayload {
  agent_id: string;
  workflow_id: string;
  permissions: string[];
  expires_at?: string;
}

export interface GrantSummary {
  totalGrants: number;
  workflowCount: number;
  agentCount: number;
  elevatedCount: number;
}

export interface GrantFilters {
  workflowId: string | null;
  agentId: string | null;
}

export function sortAgents(agents: DashboardAgentRecord[]): DashboardAgentRecord[] {
  return [...agents].sort((left, right) => {
    const leftLabel = agentDisplayName(left);
    const rightLabel = agentDisplayName(right);
    return leftLabel.localeCompare(rightLabel);
  });
}

export function buildAgentItems(agents: DashboardAgentRecord[]): ComboboxItem[] {
  return agents.map((agent) => ({
    id: agent.id,
    label: agentDisplayName(agent),
    subtitle: describeAgentOption(agent),
    status: toComboboxStatus(agent.status),
  }));
}

export function findAgent(agents: DashboardAgentRecord[], agentId: string): DashboardAgentRecord | null {
  return agents.find((agent) => agent.id === agentId) ?? null;
}

export function sortWorkflows(workflows: DashboardWorkflowRecord[]): DashboardWorkflowRecord[] {
  return [...workflows].sort((left, right) => workflowDisplayName(left).localeCompare(workflowDisplayName(right)));
}

export function buildWorkflowItems(workflows: DashboardWorkflowRecord[]): ComboboxItem[] {
  return workflows.map((workflow) => ({
    id: workflow.id,
    label: workflowDisplayName(workflow),
    subtitle: describeWorkflowOption(workflow),
    status: toWorkflowStatus(workflow.state),
  }));
}

export function findWorkflow(
  workflows: DashboardWorkflowRecord[],
  workflowId: string,
): DashboardWorkflowRecord | null {
  return workflows.find((workflow) => workflow.id === workflowId) ?? null;
}

export function sortGrants(grants: OrchestratorGrant[]): OrchestratorGrant[] {
  return [...grants].sort((left, right) => {
    const permissionOrder = grantRiskWeight(right.permissions) - grantRiskWeight(left.permissions);
    if (permissionOrder !== 0) {
      return permissionOrder;
    }
    return right.created_at.localeCompare(left.created_at);
  });
}

export function agentDisplayName(agent: DashboardAgentRecord): string {
  return agent.name?.trim() || agent.id;
}

export function workflowDisplayName(workflow: DashboardWorkflowRecord): string {
  return workflow.name.trim() || workflow.id;
}

export function describeAgentOption(agent: DashboardAgentRecord): string {
  const parts = [normalizeAgentStatus(agent.status)];
  if (agent.worker_id) {
    parts.push(`agent ${agent.worker_id}`);
  }
  if (agent.current_task_id) {
    parts.push(`task ${agent.current_task_id}`);
  }
  return parts.join(' • ');
}

export function describeWorkflowOption(workflow: DashboardWorkflowRecord): string {
  const parts: string[] = [workflow.state];
  if (workflow.workspace_name) {
    parts.push(workflow.workspace_name);
  }
  if (workflow.playbook_name) {
    parts.push(workflow.playbook_name);
  }
  return parts.join(' • ');
}

export function describeSelectedAgent(agent: DashboardAgentRecord | null): Array<{ label: string; value: string }> {
  if (!agent) {
    return [];
  }

  const details = [{ label: 'Status', value: normalizeAgentStatus(agent.status) }];
  if (agent.worker_id) {
    details.push({ label: 'Agent ID', value: agent.worker_id });
  }
  if (agent.current_task_id) {
    details.push({ label: 'Current task', value: agent.current_task_id });
  }
  return details;
}

export function describeSelectedWorkflow(
  workflow: DashboardWorkflowRecord | null,
): Array<{ label: string; value: string }> {
  if (!workflow) {
    return [];
  }

  const details: Array<{ label: string; value: string }> = [
    { label: 'State', value: workflow.state || 'unknown' },
  ];
  if (workflow.workspace_name) {
    details.push({ label: 'Workspace', value: workflow.workspace_name });
  }
  if (workflow.playbook_name) {
    details.push({ label: 'Playbook', value: workflow.playbook_name });
  }
  if (workflow.lifecycle) {
    details.push({ label: 'Lifecycle', value: workflow.lifecycle });
  }
  return details;
}

export function normalizeGrantFilters(filters: Partial<GrantFilters>): GrantFilters {
  return {
    workflowId: normalizeFilterValue(filters.workflowId),
    agentId: normalizeFilterValue(filters.agentId),
  };
}

export function readGrantFilters(searchParams: URLSearchParams): GrantFilters {
  return normalizeGrantFilters({
    workflowId: searchParams.get('workflow_id'),
    agentId: searchParams.get('agent_id'),
  });
}

export function writeGrantFilters(
  searchParams: URLSearchParams,
  filters: Partial<GrantFilters>,
): URLSearchParams {
  const next = new URLSearchParams(searchParams);
  const normalized = normalizeGrantFilters(filters);
  setFilterParam(next, 'workflow_id', normalized.workflowId);
  setFilterParam(next, 'agent_id', normalized.agentId);
  return next;
}

export function hasGrantFilters(filters: GrantFilters): boolean {
  return Boolean(filters.workflowId || filters.agentId);
}

export function fetchGrants(filters: Partial<GrantFilters> = {}): Promise<OrchestratorGrant[]> {
  const session = readSession();
  const normalizedFilters = normalizeGrantFilters(filters);
  const params = new URLSearchParams();
  if (normalizedFilters.workflowId) {
    params.set('workflow_id', normalizedFilters.workflowId);
  }
  if (normalizedFilters.agentId) {
    params.set('agent_id', normalizedFilters.agentId);
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return fetchJson<OrchestratorGrant[]>(`${API_BASE_URL}/api/v1/orchestrator-grants${suffix}`, {
    headers: session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : undefined,
    missingStatus: 404,
  });
}

export function createGrant(payload: CreateGrantPayload): Promise<OrchestratorGrant> {
  return fetchJson<OrchestratorGrant>(`${API_BASE_URL}/api/v1/orchestrator-grants`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function revokeGrant(grantId: string): Promise<void> {
  const session = readSession();
  await fetchJson(`${API_BASE_URL}/api/v1/orchestrator-grants/${grantId}`, {
    method: 'DELETE',
    headers: session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : undefined,
  });
}

export function summarizeGrants(grants: OrchestratorGrant[]): GrantSummary {
  return {
    totalGrants: grants.length,
    workflowCount: new Set(grants.map((grant) => grant.workflow_id)).size,
    agentCount: new Set(grants.map((grant) => grant.agent_id)).size,
    elevatedCount: grants.filter((grant) =>
      grant.permissions.some((permission) => permission === 'write' || permission === 'execute'),
    ).length,
  };
}

export function formatCompactId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

export function permissionVariant(
  permission: string,
): 'default' | 'success' | 'destructive' | 'warning' | 'secondary' {
  if (permission === 'execute') {
    return 'destructive';
  }
  if (permission === 'write') {
    return 'warning';
  }
  if (permission === 'read') {
    return 'success';
  }
  return 'secondary';
}

function grantRiskWeight(permissions: string[]): number {
  if (permissions.includes('execute')) {
    return 3;
  }
  if (permissions.includes('write')) {
    return 2;
  }
  if (permissions.includes('read')) {
    return 1;
  }
  return 0;
}

function normalizeAgentStatus(status: string | null | undefined): string {
  return status?.trim() || 'unknown';
}

function normalizeFilterValue(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function toComboboxStatus(
  status: string | null | undefined,
): ComboboxItem['status'] | undefined {
  switch (normalizeAgentStatus(status)) {
    case 'active':
    case 'idle':
      return 'active';
    case 'busy':
    case 'degraded':
      return 'pending';
    case 'inactive':
      return 'failed';
    default:
      return undefined;
  }
}

function toWorkflowStatus(state: string | null | undefined): ComboboxItem['status'] | undefined {
  switch (state?.trim()) {
    case 'completed':
      return 'completed';
    case 'failed':
    case 'cancelled':
      return 'failed';
    case 'active':
    case 'pending':
      return 'pending';
    default:
      return undefined;
  }
}

function setFilterParam(searchParams: URLSearchParams, key: string, value: string | null): void {
  if (value) {
    searchParams.set(key, value);
    return;
  }
  searchParams.delete(key);
}

function authHeaders(): Record<string, string> {
  const session = readSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return headers;
}

async function fetchJson<T = unknown>(
  url: string,
  options: RequestInit & { missingStatus?: number } = {},
): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
  });
  if (!response.ok) {
    if (options.missingStatus && response.status === options.missingStatus) {
      return [] as T;
    }
    throw new Error(`HTTP ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const payload = (await response.json()) as T | { data?: T };
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data?: T }).data as T;
  }
  return payload as T;
}
