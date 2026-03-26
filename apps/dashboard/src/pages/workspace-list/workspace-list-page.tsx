import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import {
  DEFAULT_LIST_PAGE_SIZE,
  ListPagination,
  paginateListItems,
} from '../../components/list-pagination.js';
import { DashboardPageHeader } from '../../components/layout/dashboard-page-header.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { dashboardApi } from '../../lib/api.js';
import { CreateWorkspaceDialog } from './workspace-list-page.dialogs.js';
import {
  WorkspaceListEmptyState,
  WorkspaceListFilteredEmptyState,
  WorkspaceListTable,
} from './workspace-list-page.table.js';
import {
  buildWorkspaceSortDirectionLabel,
  filterWorkspaces,
  normalizeWorkspaces,
  sortWorkspaces,
  type WorkspaceListSortState,
  type WorkspaceListStatusFilter,
} from './workspace-list-page.support.js';

export function WorkspaceListPage(): JSX.Element {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<WorkspaceListStatusFilter>('active');
  const [sort, setSort] = useState<WorkspaceListSortState>({
    key: 'recent_activity',
    direction: 'desc',
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_LIST_PAGE_SIZE);
  const { data, isLoading, error } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => dashboardApi.listWorkspaces(),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to load workspaces: {String(error)}
        </div>
      </div>
    );
  }

  const workspaces = normalizeWorkspaces(data ?? []);
  const filteredWorkspaces = sortWorkspaces(filterWorkspaces(workspaces, search, status), sort);
  const pagination = paginateListItems(filteredWorkspaces, page, pageSize);
  const activeCount = workspaces.filter((workspace) => workspace.is_active !== false).length;
  const inactiveCount = workspaces.length - activeCount;
  const hasFilters = search.trim().length > 0 || status !== 'active';

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <DashboardPageHeader
        navHref="/design/workspaces"
        description="Open a workspace and jump to settings, knowledge, automation, or delivery."
        actions={<CreateWorkspaceDialog />}
      />

      <div className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-sm text-muted">
              {workspaces.length} workspace{workspaces.length === 1 ? '' : 's'} · {activeCount} active · {inactiveCount} inactive
            </p>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,180px)_minmax(0,200px)_auto]">
              <label className="grid gap-2 text-sm">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  Search
                </span>
                <Input
                  aria-label="Search workspaces"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Search workspaces"
                />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  Status
                </span>
                <Select
                  value={status}
                  onValueChange={(value) => {
                    setStatus(value as WorkspaceListStatusFilter);
                    setPage(1);
                  }}
                >
                  <SelectTrigger aria-label="Workspace status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-2 text-sm">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  Sort
                </span>
                <Select
                  value={sort.key}
                  onValueChange={(value) => {
                    setSort((current) => ({
                      ...current,
                      key: value as WorkspaceListSortState['key'],
                    }));
                    setPage(1);
                  }}
                >
                  <SelectTrigger aria-label="Sort workspaces">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recent_activity">Recent activity</SelectItem>
                    <SelectItem value="workspace_name">Workspace name</SelectItem>
                    <SelectItem value="workflow_volume">Workflow volume</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <div className="grid gap-2 text-sm lg:self-end">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  Order
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSort((current) => ({
                      ...current,
                      direction: current.direction === 'asc' ? 'desc' : 'asc',
                    }));
                    setPage(1);
                  }}
                >
                  {buildWorkspaceSortDirectionLabel(sort.key, sort.direction)}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {workspaces.length === 0 ? (
        <WorkspaceListEmptyState />
      ) : filteredWorkspaces.length === 0 ? (
        <WorkspaceListFilteredEmptyState
          onResetFilters={() => {
            setSearch('');
            setStatus('all');
            setPage(1);
          }}
        />
      ) : (
        <>
          <WorkspaceListTable workspaces={pagination.items} sortKey={sort.key} />
          <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-sm">
            <ListPagination
              page={pagination.page}
              pageSize={pageSize}
              totalItems={pagination.totalItems}
              totalPages={pagination.totalPages}
              start={pagination.start}
              end={pagination.end}
              itemLabel="workspaces"
              onPageChange={setPage}
              onPageSizeChange={(value) => {
                setPageSize(value);
                setPage(1);
              }}
            />
          </div>
        </>
      )}

      {filteredWorkspaces.length > 0 && hasFilters ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
          <span>{filteredWorkspaces.length} matching workspace{filteredWorkspaces.length === 1 ? '' : 's'}</span>
        </div>
      ) : null}
    </div>
  );
}
