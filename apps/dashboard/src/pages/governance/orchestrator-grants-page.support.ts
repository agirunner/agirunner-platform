import type { ComboboxItem } from '../../components/log-viewer/ui/searchable-combobox.js';
import type { DashboardAgentRecord } from '../../lib/api.js';
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

export function agentDisplayName(agent: DashboardAgentRecord): string {
  return agent.name?.trim() || agent.id;
}

export function describeAgentOption(agent: DashboardAgentRecord): string {
  const parts = [normalizeAgentStatus(agent.status)];
  if (agent.worker_id) {
    parts.push(`worker ${agent.worker_id}`);
  }
  if (agent.current_task_id) {
    parts.push(`task ${agent.current_task_id}`);
  }
  if (agent.capabilities && agent.capabilities.length > 0) {
    parts.push(agent.capabilities.join(', '));
  }
  return parts.join(' • ');
}

export function describeSelectedAgent(agent: DashboardAgentRecord | null): Array<{ label: string; value: string }> {
  if (!agent) {
    return [];
  }

  const details = [{ label: 'Status', value: normalizeAgentStatus(agent.status) }];
  if (agent.worker_id) {
    details.push({ label: 'Worker', value: agent.worker_id });
  }
  if (agent.current_task_id) {
    details.push({ label: 'Current task', value: agent.current_task_id });
  }
  if (agent.capabilities && agent.capabilities.length > 0) {
    details.push({ label: 'Capabilities', value: agent.capabilities.join(', ') });
  }
  return details;
}

export function fetchGrants(): Promise<OrchestratorGrant[]> {
  const session = readSession();
  return fetchJson<OrchestratorGrant[]>(`${API_BASE_URL}/api/v1/orchestrator-grants`, {
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

function normalizeAgentStatus(status: string | null | undefined): string {
  return status?.trim() || 'unknown';
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
