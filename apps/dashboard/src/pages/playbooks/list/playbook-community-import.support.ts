import type {
  DashboardCommunityCatalogConflict,
  DashboardCommunityCatalogConflictAction,
  DashboardCommunityCatalogPlaybookRecord,
  DashboardCommunityCatalogStability,
} from '../../../lib/api.js';

export type CommunityCatalogStabilityFilter = 'all' | DashboardCommunityCatalogStability;

export function filterCommunityCatalogPlaybooks(
  playbooks: DashboardCommunityCatalogPlaybookRecord[],
  search: string,
  category: string,
  stability: CommunityCatalogStabilityFilter,
): DashboardCommunityCatalogPlaybookRecord[] {
  const normalizedSearch = search.trim().toLowerCase();

  return playbooks.filter((playbook) => {
    if (category !== 'all' && playbook.category !== category) {
      return false;
    }
    if (stability !== 'all' && playbook.stability !== stability) {
      return false;
    }
    if (!normalizedSearch) {
      return true;
    }

    const haystack = [
      playbook.name,
      playbook.author,
      playbook.category,
      playbook.summary,
      playbook.version,
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(normalizedSearch);
  });
}

export function listCommunityCatalogCategories(
  playbooks: DashboardCommunityCatalogPlaybookRecord[],
): string[] {
  return Array.from(new Set(playbooks.map((playbook) => playbook.category))).sort((left, right) =>
    left.localeCompare(right),
  );
}

export function resolveCommunityCatalogConflictAction(
  conflict: DashboardCommunityCatalogConflict,
  defaultAction: DashboardCommunityCatalogConflictAction,
  overrides: Record<string, DashboardCommunityCatalogConflictAction>,
): DashboardCommunityCatalogConflictAction {
  const override = overrides[conflict.key];
  if (override && conflict.availableActions.includes(override)) {
    return override;
  }
  if (conflict.availableActions.includes(defaultAction)) {
    return defaultAction;
  }
  return conflict.availableActions[0] ?? 'override_existing';
}

export function formatCommunityCatalogImportError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error ?? '')).trim();
  const normalized = message.replace(/^HTTP\s+\d+:\s*/i, '').trim();
  return normalized || 'Failed to import community playbooks.';
}
