import { useQuery } from '@tanstack/react-query';
import { Calendar, ExternalLink, Search } from 'lucide-react';
import { Link } from 'react-router-dom';

import { dashboardApi, type DashboardProjectTimelineEntry } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import {
  buildProjectDeliveryAttentionOverview,
  buildProjectDeliveryAttentionState,
  buildProjectDeliveryPacket,
  type ProjectDeliveryAttentionState,
  type ProjectDeliveryPacket,
} from './project-delivery-history-support.js';

interface DeliveryActionLink {
  label: string;
  href: string;
  icon: JSX.Element;
}

export function ProjectDeliveryHistory({ projectId }: { projectId: string }): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['project-timeline', projectId],
    queryFn: () => dashboardApi.getProjectTimeline(projectId),
  });

  if (isLoading) {
    return <ProjectDeliveryHistoryLoading />;
  }
  if (error) {
    return <ProjectDeliveryHistoryMessage message="Failed to load delivery history." />;
  }

  const entries = (data ?? []) as DashboardProjectTimelineEntry[];
  if (entries.length === 0) {
    return <ProjectDeliveryHistoryEmptyState projectId={projectId} />;
  }

  const overview = buildProjectDeliveryAttentionOverview(entries);

  return (
    <div className="space-y-4">
      <Card className="border-border/70 bg-card/80 shadow-none">
        <CardContent className="grid gap-4 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <div className="text-base font-semibold text-foreground">Delivery Overview</div>
              <p className="text-sm leading-6 text-muted">{overview.summary}</p>
            </div>
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link to={overview.nextActionHref}>Inspect next</Link>
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {overview.packets.map((packet) => (
              <div
                key={packet.label}
                className="rounded-xl border border-border/70 bg-background/70 p-3"
              >
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
                  {packet.label}
                </div>
                <div className="mt-1 text-lg font-semibold text-foreground">{packet.value}</div>
                <p className="mt-2 text-sm leading-6 text-muted">{packet.detail}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {entries.map((entry) => {
          const packet = buildProjectDeliveryPacket(entry);
          const attention = buildProjectDeliveryAttentionState(entry);
          const primaryAction = buildPrimaryAction(packet, attention);
          const secondaryAction = buildSecondaryAction(packet, attention);

          return (
            <Card key={entry.workflow_id} className="border-border/70 bg-card/80 shadow-none">
              <CardContent className="grid gap-4 p-4">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,22rem)]">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={packet.workflowHref}
                        className="text-sm font-semibold text-accent hover:underline"
                      >
                        {packet.workflowName}
                      </Link>
                      <Badge variant={packet.stateVariant} className="capitalize">
                        {packet.stateLabel}
                      </Badge>
                      <Badge variant={packet.stateVariant}>{attention.attentionLabel}</Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                      <span title={packet.createdTitle} className="inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Started {packet.createdLabel}
                      </span>
                      {packet.durationLabel ? <span>Duration {packet.durationLabel}</span> : null}
                    </div>
                    <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
                        Next Move
                      </div>
                      <p className="mt-2 text-sm leading-6 text-muted">
                        <span className="font-medium text-foreground">
                          {attention.statusLabel}:
                        </span>{' '}
                        {attention.nextAction}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
                        Recent Signals
                      </div>
                      {packet.signals.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {packet.signals.map((signal) => (
                            <span
                              key={`${packet.workflowId}:${signal}`}
                              className="rounded-full border border-border/70 bg-card px-3 py-1 text-xs text-muted"
                            >
                              {signal}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-sm leading-6 text-muted">
                          No compact delivery signals were reported for this run.
                        </p>
                      )}
                    </div>

                    <div className="flex w-full flex-col gap-2 sm:flex-row">
                      <Button asChild className="w-full sm:w-auto">
                        <Link to={primaryAction.href}>
                          {primaryAction.label}
                          {primaryAction.icon}
                        </Link>
                      </Button>
                      <Button
                        asChild
                        variant="outline"
                        className="w-full justify-between sm:w-auto"
                      >
                        <Link to={secondaryAction.href}>
                          {secondaryAction.label}
                          {secondaryAction.icon}
                        </Link>
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ProjectDeliveryHistoryLoading(): JSX.Element {
  return (
    <Card className="border-border/70 bg-card/80 shadow-none">
      <CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </CardContent>
    </Card>
  );
}

function ProjectDeliveryHistoryEmptyState({ projectId }: { projectId: string }): JSX.Element {
  return (
    <Card className="border-border/70 bg-card/80 shadow-none">
      <CardContent className="grid gap-4 p-5">
        <div className="space-y-2">
          <Badge variant="secondary">No runs yet</Badge>
          <div className="text-base font-semibold text-foreground">No delivery history yet</div>
          <p className="text-sm leading-6 text-muted">
            Start with automation or launch a workflow. The next project run will appear here with
            direct inspection links and operator-focused status.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row">
          <Button asChild className="w-full sm:w-auto">
            <Link to={`/projects/${projectId}?tab=automation`}>Open automation</Link>
          </Button>
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link to={`/projects/${projectId}`}>Back to overview</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectDeliveryHistoryMessage({ message }: { message: string }): JSX.Element {
  return (
    <Card className="border-border/70 bg-card/80 shadow-none">
      <CardContent className="py-8 text-center text-sm text-muted">{message}</CardContent>
    </Card>
  );
}

function buildPrimaryAction(
  packet: ProjectDeliveryPacket,
  attention: ProjectDeliveryAttentionState,
): DeliveryActionLink {
  if (attention.primaryActionHref === packet.inspectorHref) {
    return {
      label: 'Open inspector',
      href: packet.inspectorHref,
      icon: <Search className="h-4 w-4" />,
    };
  }

  return {
    label: 'Open board',
    href: packet.workflowHref,
    icon: <ExternalLink className="h-4 w-4" />,
  };
}

function buildSecondaryAction(
  packet: ProjectDeliveryPacket,
  attention: ProjectDeliveryAttentionState,
): DeliveryActionLink {
  if (attention.primaryActionHref === packet.workflowHref) {
    return {
      label: 'Open inspector',
      href: packet.inspectorHref,
      icon: <Search className="h-4 w-4" />,
    };
  }

  return {
    label: 'Open board',
    href: packet.workflowHref,
    icon: <ExternalLink className="h-4 w-4" />,
  };
}
