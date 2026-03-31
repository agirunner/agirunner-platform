import { Search } from 'lucide-react';

import { DashboardSectionCard } from '../../components/layout/dashboard-section-card.js';
import { ListPagination } from '../../components/list-pagination/list-pagination.js';
import type { PaginatedListResult } from '../../lib/pagination/list-pagination.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import {
  type PlaybookFamilyRecord,
  type PlaybookLifecycleFilter,
  type PlaybookSortOption,
  type PlaybookStatusFilter,
} from './playbook-list-page.support.js';
import { PlaybookLibraryEmptyState, PlaybookLibraryTable } from './playbook-list-page.table.js';

export function PlaybookLibraryToolbar(props: {
  search: string;
  statusFilter: PlaybookStatusFilter;
  lifecycleFilter: PlaybookLifecycleFilter;
  sort: PlaybookSortOption;
  familyCount: number;
  activeFamilyCount: number;
  archivedFamilyCount: number;
  onSearchChange(value: string): void;
  onStatusFilterChange(value: PlaybookStatusFilter): void;
  onLifecycleFilterChange(value: PlaybookLifecycleFilter): void;
  onSortChange(value: PlaybookSortOption): void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
      <div className="min-w-0 flex-1 space-y-3">
        <p className="text-sm text-muted">
          {props.familyCount} families · {props.activeFamilyCount} active ·{' '}
          {props.archivedFamilyCount} inactive
        </p>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,180px)_minmax(0,180px)_minmax(0,220px)]">
          <label className="grid gap-2 text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">Search</span>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                value={props.search}
                onChange={(event) => props.onSearchChange(event.target.value)}
                placeholder="Search playbooks"
                className="pl-9"
              />
            </div>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">Status</span>
            <Select
              value={props.statusFilter}
              onValueChange={(value) => props.onStatusFilterChange(value as PlaybookStatusFilter)}
            >
              <SelectTrigger aria-label="Playbook status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="archived">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              Lifecycle
            </span>
            <Select
              value={props.lifecycleFilter}
              onValueChange={(value) =>
                props.onLifecycleFilterChange(value as PlaybookLifecycleFilter)
              }
            >
              <SelectTrigger aria-label="Playbook lifecycle">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="ongoing">Ongoing</SelectItem>
                <SelectItem value="planned">Planned</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">Sort</span>
            <Select
              value={props.sort}
              onValueChange={(value) => props.onSortChange(value as PlaybookSortOption)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated-desc">Recently updated</SelectItem>
                <SelectItem value="name-asc">Name</SelectItem>
                <SelectItem value="revision-count-desc">Most revisions</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
      </div>
    </div>
  );
}

export function PlaybookLibrarySection(props: {
  search: string;
  statusFilter: PlaybookStatusFilter;
  lifecycleFilter: PlaybookLifecycleFilter;
  sort: PlaybookSortOption;
  familyCount: number;
  activeFamilyCount: number;
  archivedFamilyCount: number;
  pagination: PaginatedListResult<PlaybookFamilyRecord>;
  pageSize: number;
  hasLoading: boolean;
  hasError: boolean;
  families: PlaybookFamilyRecord[];
  togglingFamilySlug?: string | null;
  onSearchChange(value: string): void;
  onStatusFilterChange(value: PlaybookStatusFilter): void;
  onLifecycleFilterChange(value: PlaybookLifecycleFilter): void;
  onSortChange(value: PlaybookSortOption): void;
  onPageChange(value: number): void;
  onPageSizeChange(value: number): void;
  onCreatePlaybook(): void;
  onToggleActive?(family: PlaybookFamilyRecord): void;
}): JSX.Element {
  return (
    <DashboardSectionCard
      title="Playbook Library"
      description="Search, filter, and review playbook families before editing a revision or launching a workflow."
      bodyClassName="space-y-4 p-0"
    >
      <div className="px-6">
        <PlaybookLibraryToolbar
          search={props.search}
          statusFilter={props.statusFilter}
          lifecycleFilter={props.lifecycleFilter}
          sort={props.sort}
          familyCount={props.familyCount}
          activeFamilyCount={props.activeFamilyCount}
          archivedFamilyCount={props.archivedFamilyCount}
          onSearchChange={props.onSearchChange}
          onStatusFilterChange={props.onStatusFilterChange}
          onLifecycleFilterChange={props.onLifecycleFilterChange}
          onSortChange={props.onSortChange}
        />
      </div>
      {props.hasLoading ? <p className="px-6 text-sm text-muted">Loading playbooks...</p> : null}
      {props.hasError ? (
        <p className="px-6 text-sm text-red-600 dark:text-red-400">Failed to load playbooks.</p>
      ) : null}
      {props.familyCount === 0 ? (
        <div className="px-6 pb-6">
          <PlaybookLibraryEmptyState onCreatePlaybook={props.onCreatePlaybook} />
        </div>
      ) : props.families.length === 0 ? (
        <div className="px-6 pb-6">
          <DashboardSectionCard className="border-dashed bg-card/40 shadow-none">
            <p className="text-sm text-muted">No playbooks match the current search.</p>
          </DashboardSectionCard>
        </div>
      ) : (
        <>
          <PlaybookLibraryTable
            families={props.pagination.items}
            togglingFamilySlug={props.togglingFamilySlug ?? null}
            onToggleActive={props.onToggleActive}
          />
          <ListPagination
            page={props.pagination.page}
            pageSize={props.pageSize}
            totalItems={props.pagination.totalItems}
            totalPages={props.pagination.totalPages}
            start={props.pagination.start}
            end={props.pagination.end}
            itemLabel="playbook families"
            onPageChange={props.onPageChange}
            onPageSizeChange={props.onPageSizeChange}
          />
        </>
      )}
    </DashboardSectionCard>
  );
}
