import type {
  DashboardRuntimeVersionRecord,
} from '../../lib/api.js';

export function shortenRevision(revision: string | null | undefined): string {
  const normalized = revision?.trim();
  if (!normalized) {
    return 'unlabeled';
  }
  if (normalized === 'unlabeled' || normalized.length <= 7) {
    return normalized;
  }
  return normalized.slice(0, 7);
}

export function describeRuntimeVersionGroup(group: DashboardRuntimeVersionRecord): string {
  const parts = [`${group.total_containers} container${group.total_containers === 1 ? '' : 's'}`];

  if (group.orchestrator_containers > 0) {
    parts.push(
      `${group.orchestrator_containers} orchestrator${group.orchestrator_containers === 1 ? '' : 's'}`,
    );
  }
  if (group.specialist_runtime_containers > 0) {
    parts.push(
      `${group.specialist_runtime_containers} specialist runtime${group.specialist_runtime_containers === 1 ? '' : 's'}`,
    );
  }

  return parts.join(' | ');
}
