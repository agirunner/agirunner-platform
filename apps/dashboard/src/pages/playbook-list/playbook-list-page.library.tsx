import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Rocket,
  Search,
} from 'lucide-react';

import { DashboardSectionCard } from '../../components/layout/dashboard-section-card.js';
import {
  ListPagination,
  type PaginatedListResult,
} from '../../components/list-pagination.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { IconActionButton } from '../../components/ui/icon-action-button.js';
import { Input } from '../../components/ui/input.js';
import { DASHBOARD_BADGE_TOKENS } from '../../lib/dashboard-badge-palette.js';
import { Switch } from '../../components/ui/switch.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import {
  type PlaybookFamilyRecord,
  type PlaybookLifecycleFilter,
  type PlaybookSortOption,
  type PlaybookStatusFilter,
} from './playbook-list-page.support.js';

function describePlaybookLifecycle(lifecycle: 'planned' | 'ongoing'): string {
  return lifecycle === 'planned' ? 'Planned' : 'Ongoing';
}

function playbookLifecycleBadgeClassName(lifecycle: 'planned' | 'ongoing'): string {
  return lifecycle === 'ongoing'
    ? DASHBOARD_BADGE_TOKENS.success.className
    : DASHBOARD_BADGE_TOKENS.informationSecondary.className;
}

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
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              Search
            </span>
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
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              Status
            </span>
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
              onValueChange={(value) => props.onLifecycleFilterChange(value as PlaybookLifecycleFilter)}
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
            <Select value={props.sort} onValueChange={(value) => props.onSortChange(value as PlaybookSortOption)}>
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
      {props.families.length === 0 ? (
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

export function PlaybookLibraryTable(props: {
  families: PlaybookFamilyRecord[];
  togglingFamilySlug?: string | null;
  onToggleActive?(family: PlaybookFamilyRecord): void;
}): JSX.Element {
  return (
    <div className="overflow-x-auto border-y border-border/70">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Playbook</TableHead>
            <TableHead>Lifecycle</TableHead>
            <TableHead>Team</TableHead>
            <TableHead>Structure</TableHead>
            <TableHead>Revision</TableHead>
            <TableHead className="w-[160px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.families.map((family) => (
            <PlaybookFamilyRow
              key={family.slug}
              family={family}
              togglingFamilySlug={props.togglingFamilySlug ?? null}
              onToggleActive={props.onToggleActive}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function PlaybookFamilyRow(props: {
  family: PlaybookFamilyRecord;
  togglingFamilySlug: string | null;
  onToggleActive?(family: PlaybookFamilyRecord): void;
}): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const { family } = props;
  const playbook = family.primaryRevision;
  const isArchivedFamily = family.activeRevisionCount === 0;
  const isTogglePending = props.togglingFamilySlug === family.slug;
  const processSummary =
    family.process.processInstructions || 'Open the playbook to define process instructions.';

  return (
    <>
      <TableRow
        className={isArchivedFamily ? 'opacity-75' : undefined}
        onClick={() => setIsExpanded((value) => !value)}
      >
        <TableCell>
          <div className="flex items-start gap-2">
            {isExpanded ? (
              <ChevronDown className="mt-1 h-4 w-4 text-muted" />
            ) : (
              <ChevronRight className="mt-1 h-4 w-4 text-muted" />
            )}
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link className="font-medium text-foreground underline-offset-4 hover:underline" to={`/design/playbooks/${playbook.id}`}>
                  {family.name}
                </Link>
                <Switch
                  checked={!isArchivedFamily}
                  disabled={isTogglePending}
                  onCheckedChange={() => props.onToggleActive?.(family)}
                  onClick={(event) => event.stopPropagation()}
                  aria-label={`Toggle ${family.name} active`}
                  className="scale-90"
                />
                <Badge variant={isArchivedFamily ? 'secondary' : 'success'}>
                  {isArchivedFamily ? 'Inactive' : 'Active'}
                </Badge>
                <Badge variant="outline">v{playbook.version}</Badge>
              </div>
              <p className="text-sm text-foreground">{family.slug}</p>
            </div>
          </div>
        </TableCell>
        <TableCell>
          <Badge variant="outline" className={playbookLifecycleBadgeClassName(family.lifecycle)}>
            {describePlaybookLifecycle(family.lifecycle)}
          </Badge>
        </TableCell>
        <TableCell className="text-sm text-foreground">
          {family.process.roleCount} roles · {family.process.inputCount} goals
        </TableCell>
        <TableCell className="text-sm text-foreground">
          {family.structure.stages} stages / {family.structure.boardColumns} columns
        </TableCell>
        <TableCell className="text-sm text-foreground">
          v{playbook.version} · {family.revisionCount} revision{family.revisionCount === 1 ? '' : 's'}
        </TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-2">
            <IconActionButton
              asChild
              label={`Open ${family.name}`}
              onClick={(event) => event.stopPropagation()}
            >
              <Link to={`/design/playbooks/${playbook.id}`}>
                <Pencil className="h-4 w-4" />
              </Link>
            </IconActionButton>
            {isArchivedFamily ? (
              <IconActionButton
                label={`Launch ${family.name}`}
                disabled
                onClick={(event) => event.stopPropagation()}
              >
                <Rocket className="h-4 w-4" />
              </IconActionButton>
            ) : (
              <IconActionButton
                asChild
                label={`Launch ${family.name}`}
                onClick={(event) => event.stopPropagation()}
              >
                <Link to={`/design/playbooks/${playbook.id}/launch`}>
                  <Rocket className="h-4 w-4" />
                </Link>
              </IconActionButton>
            )}
          </div>
        </TableCell>
      </TableRow>
      {isExpanded ? (
        <TableRow>
          <TableCell colSpan={6} className="bg-border/10">
            <div className="space-y-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                Playbook details
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr),minmax(0,1.2fr)]">
                <div className="rounded-lg border border-border/70 bg-background/80 p-3 text-sm">
                  <div className="font-medium">Process</div>
                  <div className="mt-2 text-muted">{processSummary}</div>
                </div>
                <div className="rounded-lg border border-border/70 bg-background/80 p-3 text-sm">
                  <div className="font-medium">Outcome</div>
                  <div className="mt-2 text-muted">{family.outcome}</div>
                </div>
              </div>
              {isArchivedFamily ? (
                <div className="rounded-md border border-amber-300 bg-amber-50/80 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                  This playbook is inactive. Use the row toggle to reactivate the family before
                  launching a new workflow.
                </div>
              ) : null}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
