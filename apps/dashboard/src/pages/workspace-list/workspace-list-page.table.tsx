import { useState } from 'react';
import { ChevronDown, ChevronRight, FolderOpen, Pencil } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { DashboardWorkspaceRecord } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { IconActionButton } from '../../components/ui/icon-action-button.js';
import { Switch } from '../../components/ui/switch.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import { CreateWorkspaceDialog } from './workspace-list-page.dialogs.js';
import {
  buildWorkspaceActivityLabel,
  buildWorkspaceMetrics,
  buildWorkspaceReadiness,
  buildWorkspaceStorageSummary,
  type WorkspaceListSortField,
} from './workspace-list-page.support.js';
import { readWorkspaceStorageLabel } from '../workspace-detail/workspace-detail-support.js';

export function WorkspaceListTable(props: {
  workspaces: DashboardWorkspaceRecord[];
  sortKey?: WorkspaceListSortField;
  togglingWorkspaceId?: string | null;
  onToggleActive?(workspace: DashboardWorkspaceRecord): void;
}): JSX.Element {
  return (
    <div className="overflow-x-auto border-y border-border/70">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Workspace</TableHead>
            <TableHead>Storage</TableHead>
            <TableHead>Workflows</TableHead>
            <TableHead>Last activity</TableHead>
            <TableHead className="w-[120px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.workspaces.map((workspace) => (
            <WorkspaceTableRow
              key={workspace.id}
              workspace={workspace}
              sortKey={props.sortKey ?? 'recent_activity'}
              togglingWorkspaceId={props.togglingWorkspaceId ?? null}
              onToggleActive={props.onToggleActive}
            />
          ))}
        </TableBody>
      </Table>
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

function WorkspaceTableRow(props: {
  workspace: DashboardWorkspaceRecord;
  sortKey: WorkspaceListSortField;
  togglingWorkspaceId: string | null;
  onToggleActive?(workspace: DashboardWorkspaceRecord): void;
}): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const workspaceLinkState = { workspaceLabel: props.workspace.name };
  const readiness = buildWorkspaceReadiness(props.workspace);
  const workspaceMetrics = buildWorkspaceMetrics(props.workspace, props.sortKey);
  const storageLabel = readWorkspaceStorageLabel(props.workspace);
  const storageSummary = buildWorkspaceStorageSummary(props.workspace);
  const activityLabel = buildWorkspaceActivityLabel(props.workspace);
  const isTogglePending = props.togglingWorkspaceId === props.workspace.id;

  return (
    <>
      <TableRow
        className={props.workspace.is_active === false ? 'opacity-75' : undefined}
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
                <Link
                  to={`/design/workspaces/${props.workspace.id}`}
                  state={workspaceLinkState}
                  className="font-medium text-foreground underline-offset-4 transition hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  {props.workspace.name}
                </Link>
                <Switch
                  checked={props.workspace.is_active !== false}
                  disabled={isTogglePending}
                  onCheckedChange={() => props.onToggleActive?.(props.workspace)}
                  onClick={(event) => event.stopPropagation()}
                  aria-label={`Toggle ${props.workspace.name} active`}
                  className="scale-90"
                />
                <Badge variant={readiness.variant}>{readiness.label}</Badge>
              </div>
            </div>
          </div>
        </TableCell>
        <TableCell className="text-sm text-foreground">{storageLabel}</TableCell>
        <TableCell className="text-sm text-foreground">{workspaceMetrics}</TableCell>
        <TableCell className="text-sm text-foreground">{activityLabel}</TableCell>
        <TableCell className="text-right">
          <IconActionButton
            asChild
            label={`Open ${props.workspace.name}`}
            onClick={(event) => event.stopPropagation()}
          >
            <Link to={`/design/workspaces/${props.workspace.id}`} state={workspaceLinkState}>
              <Pencil className="h-4 w-4" />
            </Link>
          </IconActionButton>
        </TableCell>
      </TableRow>
      {isExpanded ? (
        <TableRow>
          <TableCell colSpan={5} className="bg-border/10">
            <div className="space-y-2 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                Workspace details
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-border/70 bg-background/80 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                    Slug
                  </div>
                  <div className="mt-2 text-sm text-foreground">{props.workspace.slug}</div>
                </div>
                <div className="rounded-lg border border-border/70 bg-background/80 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                    Workspace storage
                  </div>
                  <div className="mt-2 text-sm text-foreground">{storageSummary}</div>
                </div>
                <div className="rounded-lg border border-border/70 bg-background/80 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
                    Workflow posture
                  </div>
                  <div className="mt-2 text-sm text-foreground">{workspaceMetrics}</div>
                </div>
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
