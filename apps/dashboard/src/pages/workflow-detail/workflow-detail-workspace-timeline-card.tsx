import { Link, useLocation } from 'react-router-dom';

import type { DashboardWorkspaceTimelineEntry } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import {
  buildWorkflowDetailPermalink,
  isWorkflowDetailTargetHighlighted,
} from '../../app/routes/workflow-navigation.js';
import {
  buildWorkflowWorkspaceTimelineOverview,
  buildWorkflowWorkspaceTimelinePacket,
} from './workflow-workspace-timeline-support.js';

export function WorkspaceTimelineCard(props: {
  isLoading: boolean;
  hasError: boolean;
  entries: DashboardWorkspaceTimelineEntry[];
  currentWorkflowId: string;
  selectedChildWorkflowId?: string | null;
  onSelectChildWorkflow?(workflowId: string): void;
}) {
  const location = useLocation();
  const overview = buildWorkflowWorkspaceTimelineOverview(props.entries);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace Timeline</CardTitle>
        <CardDescription>
          Run-level continuity for this workspace, including chained lineage.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {props.isLoading ? <p className="text-sm text-muted">Loading timeline...</p> : null}
        {props.hasError ? <p className="text-sm text-red-600">Failed to load workspace timeline.</p> : null}
        {props.entries.length > 0 ? (
          <div className="grid gap-4 rounded-xl border border-border/70 bg-background/70 p-4">
            <div className="grid gap-1">
              <div className="text-sm font-medium text-foreground">Run continuity</div>
              <p className="text-sm leading-6 text-muted">{overview.summary}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {overview.metrics.map((metric) => (
                <div
                  key={metric.label}
                  className="grid gap-1 rounded-xl border border-border/70 bg-card/70 p-4"
                >
                  <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                    {metric.label}
                  </div>
                  <div className="text-sm font-semibold text-foreground">{metric.value}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="grid gap-4">
          {props.entries.map((entry) => {
            const packet = buildWorkflowWorkspaceTimelinePacket(entry);
            const isCurrentWorkflow = entry.workflow_id === props.currentWorkflowId;
            return (
              <article
                key={entry.workflow_id}
                id={`child-workflow-${entry.workflow_id}`}
                className="grid gap-3 rounded-lg border border-border/70 bg-border/10 p-4"
                tabIndex={-1}
                data-workflow-focus-anchor="true"
                aria-labelledby={`child-workflow-heading-${entry.workflow_id}`}
                data-highlighted={
                  props.selectedChildWorkflowId === entry.workflow_id ||
                  isWorkflowDetailTargetHighlighted(
                    location.search,
                    location.hash,
                    'child',
                    entry.workflow_id,
                  )
                    ? 'true'
                    : 'false'
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="grid gap-1">
                    <strong id={`child-workflow-heading-${entry.workflow_id}`}>
                      {packet.workflowName}
                    </strong>
                    <p className="text-sm text-muted">{packet.summary}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {isCurrentWorkflow ? <Badge variant="secondary">Current board</Badge> : null}
                    <Badge variant={badgeVariantForState(entry.state)}>{packet.stateLabel}</Badge>
                  </div>
                </div>
                <div className="grid gap-3 rounded-xl border border-border/70 bg-background/80 p-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" title={packet.createdTitle}>
                      Created {packet.createdLabel}
                    </Badge>
                    <Badge variant="outline">{packet.completedLabel}</Badge>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {packet.metrics.map((metric) => (
                      <div
                        key={`${entry.workflow_id}:${metric.label}`}
                        className="grid gap-1 rounded-xl border border-border/70 bg-card/70 p-3"
                      >
                        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                          {metric.label}
                        </div>
                        <div className="text-sm font-semibold text-foreground">{metric.value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-xl border border-border/70 bg-card/70 p-3 text-sm leading-6 text-muted">
                    <span className="font-medium text-foreground">Best next step:</span>{' '}
                    {packet.nextAction}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => props.onSelectChildWorkflow?.(entry.workflow_id)}
                  >
                    Highlight lineage
                  </Button>
                  <div className="flex flex-wrap items-center gap-3">
                    {!isCurrentWorkflow ? (
                      <Link to={packet.workflowHref}>Open board</Link>
                    ) : null}
                    <Link to={packet.inspectorHref}>Open inspector</Link>
                    <Link
                      to={buildWorkflowDetailPermalink(props.currentWorkflowId, {
                        childWorkflowId: entry.workflow_id,
                      })}
                      className="text-sm text-muted underline-offset-4 hover:underline"
                    >
                      Permalink
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function badgeVariantForState(
  state: string | null | undefined,
): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' {
  switch (state) {
    case 'completed':
    case 'approved':
      return 'success';
    case 'failed':
    case 'rejected':
    case 'cancelled':
      return 'destructive';
    case 'blocked':
    case 'escalated':
    case 'awaiting_approval':
      return 'warning';
    case 'in_progress':
    case 'running':
    case 'processing':
      return 'default';
    default:
      return 'outline';
  }
}
