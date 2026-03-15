import type { DashboardPlaybookRecord } from '../../lib/api.js';

export type PlaybookStatusFilter = 'all' | 'active' | 'archived';
export type PlaybookLifecycleFilter = 'all' | 'planned' | 'ongoing';
export type PlaybookSortOption = 'updated-desc' | 'name-asc' | 'revision-count-desc';

export interface PlaybookFamilyRecord {
  slug: string;
  name: string;
  description?: string | null;
  outcome: string;
  lifecycle: 'planned' | 'ongoing';
  revisions: DashboardPlaybookRecord[];
  revisionCount: number;
  activeRevisionCount: number;
  primaryRevision: DashboardPlaybookRecord;
  structure: ReturnType<typeof summarizePlaybookStructure>;
  updatedAt: string;
  searchText: string;
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

export function buildPlaybookFamilies(
  playbooks: DashboardPlaybookRecord[],
): PlaybookFamilyRecord[] {
  const families = new Map<string, DashboardPlaybookRecord[]>();
  for (const playbook of playbooks) {
    const key = playbook.slug || playbook.id;
    const current = families.get(key) ?? [];
    current.push(playbook);
    families.set(key, current);
  }

  return Array.from(families.entries()).map(([slug, revisions]) => {
    const orderedRevisions = [...revisions].sort((left, right) =>
      comparePlaybookRecency(right, left),
    );
    const activeRevisions = orderedRevisions.filter((entry) => entry.is_active !== false);
    const primaryRevision = activeRevisions[0] ?? orderedRevisions[0];

    return {
      slug,
      name: primaryRevision.name,
      description: primaryRevision.description ?? null,
      outcome: primaryRevision.outcome,
      lifecycle: primaryRevision.lifecycle,
      revisions: orderedRevisions,
      revisionCount: orderedRevisions.length,
      activeRevisionCount: activeRevisions.length,
      primaryRevision,
      structure: summarizePlaybookStructure(primaryRevision),
      updatedAt: readPlaybookUpdatedAt(primaryRevision),
      searchText: orderedRevisions
        .flatMap((playbook) => [playbook.name, playbook.slug, playbook.description ?? '', playbook.outcome])
        .join(' ')
        .toLowerCase(),
    };
  });
}

export function filterPlaybookFamilies(
  families: PlaybookFamilyRecord[],
  search: string,
  statusFilter: PlaybookStatusFilter,
  lifecycleFilter: PlaybookLifecycleFilter,
  sort: PlaybookSortOption,
): PlaybookFamilyRecord[] {
  const normalized = search.trim().toLowerCase();
  return families
    .filter((family) => {
      if (normalized && !family.searchText.includes(normalized)) {
        return false;
      }
      if (statusFilter === 'active' && family.activeRevisionCount === 0) {
        return false;
      }
      if (statusFilter === 'archived' && family.activeRevisionCount > 0) {
        return false;
      }
      if (lifecycleFilter !== 'all' && family.lifecycle !== lifecycleFilter) {
        return false;
      }
      return true;
    })
    .sort((left, right) => comparePlaybookFamilies(left, right, sort));
}

export function summarizePlaybookFamilyCounts(
  families: PlaybookFamilyRecord[],
): {
  familyCount: number;
  activeFamilyCount: number;
  archivedFamilyCount: number;
} {
  const activeFamilyCount = families.filter((family) => family.activeRevisionCount > 0).length;
  return {
    familyCount: families.length,
    activeFamilyCount,
    archivedFamilyCount: families.length - activeFamilyCount,
  };
}

function comparePlaybookFamilies(
  left: PlaybookFamilyRecord,
  right: PlaybookFamilyRecord,
  sort: PlaybookSortOption,
): number {
  if (sort === 'name-asc') {
    return left.name.localeCompare(right.name);
  }
  if (sort === 'revision-count-desc') {
    return (
      right.revisionCount - left.revisionCount ||
      comparePlaybookRecency(right.primaryRevision, left.primaryRevision)
    );
  }
  return comparePlaybookRecency(right.primaryRevision, left.primaryRevision);
}

function comparePlaybookRecency(left: DashboardPlaybookRecord, right: DashboardPlaybookRecord): number {
  return readPlaybookUpdatedAt(left).localeCompare(readPlaybookUpdatedAt(right));
}

function readPlaybookUpdatedAt(playbook: DashboardPlaybookRecord): string {
  return playbook.updated_at ?? playbook.created_at ?? '';
}

export function filterPlaybooks(
  playbooks: DashboardPlaybookRecord[],
  search: string,
  statusFilter: PlaybookStatusFilter,
  lifecycleFilter: PlaybookLifecycleFilter,
): DashboardPlaybookRecord[] {
  return playbooks.filter((playbook) => {
    if (
      search.trim().length > 0 &&
      ![playbook.name, playbook.slug, playbook.description ?? '', playbook.outcome]
        .join(' ')
        .toLowerCase()
        .includes(search.trim().toLowerCase())
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
