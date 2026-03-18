import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { dashboardApi } from '../../lib/api.js';
import { CreateWorkspaceDialog } from './workspace-list-page.dialogs.js';
import {
  WorkspaceListEmptyState,
  WorkspaceListFilteredEmptyState,
  WorkspaceListGrid,
} from './workspace-list-page.cards.js';
import {
  buildWorkspaceSortDirectionLabel,
  filterWorkspaces,
  normalizeWorkspaces,
  sortWorkspaces,
  type WorkspaceListSortState,
} from './workspace-list-page.support.js';

export function WorkspaceListPage(): JSX.Element {
  const [showInactive, setShowInactive] = useState(false);
  const [sort, setSort] = useState<WorkspaceListSortState>({
    key: 'recent_activity',
    direction: 'desc',
  });
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
  const hasInactiveWorkspaces = workspaces.some((workspace) => workspace.is_active === false);
  const visibleWorkspaces = sortWorkspaces(filterWorkspaces(workspaces, showInactive), sort);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="text-2xl font-semibold">Workspaces</h1>
          <p className="text-sm leading-6 text-muted">
            Open a workspace and jump to settings, knowledge, automation, or delivery.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {hasInactiveWorkspaces ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowInactive((current) => !current)}
            >
              {showInactive ? 'Hide inactive' : 'Show inactive'}
            </Button>
          ) : null}
          {workspaces.length > 1 ? (
            <>
              <select
                aria-label="Sort workspaces"
                className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm outline-none focus:ring-2 focus:ring-ring"
                value={sort.key}
                onChange={(event) =>
                  setSort((current) => ({
                    ...current,
                    key: event.target.value as WorkspaceListSortState['key'],
                  }))
                }
              >
                <option value="recent_activity">Recent activity</option>
                <option value="workspace_name">Workspace name</option>
                <option value="workflow_volume">Workflow volume</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setSort((current) => ({
                    ...current,
                    direction: current.direction === 'asc' ? 'desc' : 'asc',
                  }))
                }
              >
                {buildWorkspaceSortDirectionLabel(sort.key, sort.direction)}
              </Button>
            </>
          ) : null}
          <CreateWorkspaceDialog />
        </div>
      </div>

      {visibleWorkspaces.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
          <span>{visibleWorkspaces.length} visible workspace{visibleWorkspaces.length === 1 ? '' : 's'}</span>
          {hasInactiveWorkspaces && !showInactive ? (
            <span>{workspaces.length - visibleWorkspaces.length} inactive hidden</span>
          ) : null}
        </div>
      ) : null}

      {workspaces.length === 0 ? (
        <WorkspaceListEmptyState />
      ) : visibleWorkspaces.length === 0 ? (
        <WorkspaceListFilteredEmptyState
          onShowInactive={() => {
            setShowInactive(true);
          }}
        />
      ) : (
        <WorkspaceListGrid workspaces={visibleWorkspaces} />
      )}
    </div>
  );
}
