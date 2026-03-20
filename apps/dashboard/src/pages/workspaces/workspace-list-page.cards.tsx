import { FolderOpen } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { DashboardWorkspaceRecord } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { CreateWorkspaceDialog } from './workspace-list-page.dialogs.js';
import {
  buildWorkspaceMetrics,
  buildWorkspaceReadiness,
  type WorkspaceListSortField,
} from './workspace-list-page.support.js';
import { readWorkspaceStorageLabel } from './workspace-detail-support.js';

export function WorkspaceListGrid(props: {
  workspaces: DashboardWorkspaceRecord[];
  sortKey?: WorkspaceListSortField;
}): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {props.workspaces.map((workspace) => (
        <WorkspaceCard
          key={workspace.id}
          workspace={workspace}
          sortKey={props.sortKey ?? 'recent_activity'}
        />
      ))}
    </div>
  );
}

export function WorkspaceListEmptyState(): JSX.Element {
  return (
    <Card className="border-border/70 bg-card/80 shadow-none">
      <CardContent className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <FolderOpen className="h-12 w-12 text-muted" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">No workspaces yet</p>
          <p className="max-w-2xl text-sm leading-6 text-muted">
            Create the first workspace, then manage storage, memory, artifacts, and delivery from one place.
          </p>
        </div>
        <CreateWorkspaceDialog buttonLabel="Create first workspace" buttonClassName="w-full sm:w-auto" />
      </CardContent>
    </Card>
  );
}

export function WorkspaceListFilteredEmptyState(props: {
  onResetFilters: () => void;
}): JSX.Element {
  return (
    <Card className="border-border/70 bg-card/80 shadow-none">
      <CardContent className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <div className="space-y-1">
          <p className="font-medium text-foreground">No workspaces match the current filters</p>
          <p className="max-w-2xl text-sm leading-6 text-muted">
            Adjust the search or filter settings to bring matching workspaces back into the list.
          </p>
        </div>
        <Button variant="outline" onClick={props.onResetFilters}>
          Reset filters
        </Button>
      </CardContent>
    </Card>
  );
}

function WorkspaceCard(props: {
  workspace: DashboardWorkspaceRecord;
  sortKey: WorkspaceListSortField;
}): JSX.Element {
  const workspaceLinkState = { workspaceLabel: props.workspace.name };
  const readiness = buildWorkspaceReadiness(props.workspace);
  const workspaceMetrics = buildWorkspaceMetrics(props.workspace, props.sortKey);
  const storageLabel = readWorkspaceStorageLabel(props.workspace);

  return (
    <Card className="flex flex-col overflow-hidden border-border/70 bg-card/80 shadow-sm">
      <CardHeader className="space-y-3 pb-2">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base leading-6">
            <Link
              to={`/workspaces/${props.workspace.id}`}
              state={workspaceLinkState}
              className="rounded-sm underline-offset-4 transition hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {props.workspace.name}
            </Link>
          </CardTitle>
          <Badge variant={readiness.variant}>{readiness.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 pt-0">
        <div className="rounded-xl border border-border/70 bg-muted/15 px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Storage</span>
            <span className="font-medium text-foreground">{storageLabel}</span>
          </div>
        </div>
        <div className="rounded-xl border border-border/70 bg-muted/15 px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Workflows</span>
            <span className="text-right font-medium text-foreground">{workspaceMetrics}</span>
          </div>
        </div>
        <div className="mt-auto flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link to={`/workspaces/${props.workspace.id}`} state={workspaceLinkState}>
              Manage
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
