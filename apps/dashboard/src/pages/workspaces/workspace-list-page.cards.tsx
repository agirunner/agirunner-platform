import { ChevronRight, FolderOpen } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { DashboardWorkspaceRecord } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { CreateWorkspaceDialog } from './workspace-list-page.dialogs.js';
import {
  buildWorkspaceDescription,
  buildWorkspaceMetrics,
  buildWorkspaceReadiness,
  type WorkspaceListSortField,
} from './workspace-list-page.support.js';

const WORKSPACE_WORKSPACE_LINKS = [
  { label: 'Settings', tab: 'settings' },
  { label: 'Knowledge', tab: 'knowledge' },
  { label: 'Automation', tab: 'automation' },
  { label: 'Delivery', tab: 'delivery' },
] as const;

const PRIMARY_WORKSPACE_LINK_CLASS_NAME =
  'group flex items-center justify-between rounded-lg border border-border/70 bg-background/80 px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-foreground/20 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

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
            Create the first workspace, add a short description, and then use the workspace links to
            continue deeper work in settings, delivery, or knowledge.
          </p>
        </div>
        <CreateWorkspaceDialog buttonLabel="Create first workspace" buttonClassName="w-full sm:w-auto" />
      </CardContent>
    </Card>
  );
}

export function WorkspaceListFilteredEmptyState(props: {
  onShowInactive: () => void;
}): JSX.Element {
  return (
    <Card className="border-border/70 bg-card/80 shadow-none">
      <CardContent className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <div className="space-y-1">
          <p className="font-medium text-foreground">No active workspaces to show</p>
          <p className="max-w-2xl text-sm leading-6 text-muted">
            Every workspace in this list is inactive right now. Use the filter to review paused
            workspaces.
          </p>
        </div>
        <Button variant="outline" onClick={props.onShowInactive}>
          Show inactive
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

  return (
    <Card className="overflow-hidden border-border/70 bg-card/80 shadow-none">
      <CardHeader className="space-y-3 pb-3">
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
        <p className="text-sm leading-6 text-muted">{buildWorkspaceDescription(props.workspace)}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs font-medium text-muted">{workspaceMetrics}</p>
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
            Open workspace
          </p>
          <div className="grid grid-cols-2 gap-2">
            {WORKSPACE_WORKSPACE_LINKS.map((workspace) => (
              <Link
                key={workspace.tab}
                className={PRIMARY_WORKSPACE_LINK_CLASS_NAME}
                to={`/workspaces/${props.workspace.id}?tab=${workspace.tab}`}
                state={workspaceLinkState}
              >
                <span>{workspace.label}</span>
                <ChevronRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
