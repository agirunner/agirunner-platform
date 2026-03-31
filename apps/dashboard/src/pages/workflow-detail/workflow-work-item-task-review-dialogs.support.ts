import type { DashboardAgentRecord } from '../../lib/api.js';
import type { ComboboxItem } from '../../components/log-viewer/ui/searchable-combobox.js';

export function sortAgents(agents: DashboardAgentRecord[]): DashboardAgentRecord[] {
  return [...agents].sort((left, right) =>
    agentDisplayName(left).localeCompare(agentDisplayName(right)),
  );
}

export function agentDisplayName(agent: DashboardAgentRecord): string {
  return agent.name?.trim() || agent.id;
}

function describeAgent(agent: DashboardAgentRecord): string {
  const parts = [agent.status?.trim() || 'unknown'];
  if (agent.worker_id) {
    parts.push(`agent ${agent.worker_id}`);
  }
  return parts.join(' • ');
}

export function buildAgentItems(agents: DashboardAgentRecord[]): ComboboxItem[] {
  return agents.map((agent) => ({
    id: agent.id,
    label: agentDisplayName(agent),
    subtitle: describeAgent(agent),
    status:
      agent.status === 'active'
        ? 'active'
        : agent.status === 'completed'
          ? 'completed'
          : agent.status === 'failed'
            ? 'failed'
            : 'pending',
  }));
}

export function formatOutputOverrideDraft(output: unknown): string {
  if (output === undefined) {
    return '{}';
  }
  return JSON.stringify(output, null, 2);
}

export function parseOutputOverrideDraft(draft: string): unknown {
  const trimmed = draft.trim();
  if (!trimmed) {
    throw new Error('Add replacement output JSON before overriding the stored packet.');
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error('Output override must be valid JSON.');
  }
}
