import type { DashboardPlaybookRecord } from '../../lib/api.js';

export type PlaybookStatusFilter = 'all' | 'active' | 'archived';
export type PlaybookLifecycleFilter = 'all' | 'standard' | 'continuous';

export interface PlaybookLibrarySummaryCard {
  label: string;
  value: string;
  detail: string;
}

export interface PlaybookCreateValidationResult {
  normalizedSlug: string;
  slugSource: 'name' | 'custom';
  fieldErrors: {
    name?: string;
    slug?: string;
    outcome?: string;
  };
  blockingIssues: string[];
  isValid: boolean;
}

export function filterPlaybooks(
  playbooks: DashboardPlaybookRecord[],
  search: string,
  statusFilter: PlaybookStatusFilter,
  lifecycleFilter: PlaybookLifecycleFilter,
): DashboardPlaybookRecord[] {
  const normalized = search.trim().toLowerCase();
  return playbooks.filter((playbook) => {
    if (
      normalized &&
      ![playbook.name, playbook.slug, playbook.description ?? '', playbook.outcome]
        .join(' ')
        .toLowerCase()
        .includes(normalized)
    ) {
      return false;
    }
    if (statusFilter === 'active' && playbook.is_active === false) {
      return false;
    }
    if (statusFilter === 'archived' && playbook.is_active !== false) {
      return false;
    }
    if (lifecycleFilter !== 'all' && playbook.lifecycle !== lifecycleFilter) {
      return false;
    }
    return true;
  });
}

export function summarizePlaybookLibrary(
  playbooks: DashboardPlaybookRecord[],
): PlaybookLibrarySummaryCard[] {
  const activeCount = playbooks.filter((playbook) => playbook.is_active !== false).length;
  const archivedCount = playbooks.length - activeCount;
  const continuousCount = playbooks.filter((playbook) => playbook.lifecycle === 'continuous').length;

  return [
    {
      label: 'Active revisions',
      value: activeCount === 0 ? 'None active' : `${activeCount} active`,
      detail:
        activeCount === 0
          ? 'Restore or create a playbook before launch is available.'
          : `${activeCount} launchable playbook revision${activeCount === 1 ? '' : 's'} currently available.`,
    },
    {
      label: 'Archived revisions',
      value: archivedCount === 0 ? 'No archived' : `${archivedCount} archived`,
      detail:
        archivedCount === 0
          ? 'No archived revisions need review right now.'
          : 'Archived playbooks stay available for review and restore, but cannot launch until reactivated.',
    },
    {
      label: 'Lifecycle mix',
      value:
        playbooks.length === 0
          ? 'No playbooks'
          : `${continuousCount} continuous / ${playbooks.length - continuousCount} standard`,
      detail:
        playbooks.length === 0
          ? 'Create the first playbook to define your workflow operating model.'
          : 'Use lifecycle mix to confirm whether the library is skewed toward repeatable or milestone-based work.',
    },
  ];
}

export function validatePlaybookCreateDraft(input: {
  name: string;
  slug: string;
  outcome: string;
  playbooks: DashboardPlaybookRecord[];
}): PlaybookCreateValidationResult {
  const name = input.name.trim();
  const customSlug = input.slug.trim();
  const outcome = input.outcome.trim();
  const slugSource = customSlug ? 'custom' : 'name';
  const normalizedSlug = normalizePlaybookSlug(customSlug || name);
  const fieldErrors: PlaybookCreateValidationResult['fieldErrors'] = {};

  if (!name) {
    fieldErrors.name = 'Enter a playbook name.';
  }
  if (!outcome) {
    fieldErrors.outcome = 'Describe the workflow outcome this playbook owns.';
  }

  if ((customSlug || name) && !normalizedSlug) {
    if (customSlug) {
      fieldErrors.slug = 'Use letters or numbers so the slug can be generated.';
    } else {
      fieldErrors.name = 'Use letters or numbers so the generated slug is valid.';
    }
  } else if (
    normalizedSlug &&
    input.playbooks.some((playbook) => playbook.slug === normalizedSlug)
  ) {
    fieldErrors.slug = `Slug '${normalizedSlug}' already exists. Choose a different name or custom slug.`;
  }

  const blockingIssues = [fieldErrors.name, fieldErrors.slug, fieldErrors.outcome].filter(
    (issue): issue is string => Boolean(issue),
  );

  return {
    normalizedSlug,
    slugSource,
    fieldErrors,
    blockingIssues,
    isValid: blockingIssues.length === 0,
  };
}

export function summarizePlaybookStructure(playbook: DashboardPlaybookRecord): {
  boardColumns: number;
  stages: number;
} {
  const boardColumns = Array.isArray(
    (playbook.definition as { board?: { columns?: unknown[] } }).board?.columns,
  )
    ? ((playbook.definition as { board?: { columns?: unknown[] } }).board?.columns?.length ?? 0)
    : 0;
  const stages = Array.isArray((playbook.definition as { stages?: unknown[] }).stages)
    ? ((playbook.definition as { stages?: unknown[] }).stages?.length ?? 0)
    : 0;
  return { boardColumns, stages };
}

function normalizePlaybookSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
