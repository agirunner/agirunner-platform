import { useQuery } from '@tanstack/react-query';
import { Calendar, ExternalLink, Search } from 'lucide-react';
import { Link } from 'react-router-dom';

import { dashboardApi, type DashboardProjectTimelineEntry } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import {
  buildProjectDeliveryOverview,
  buildProjectDeliveryPacket,
} from './project-delivery-history-support.js';

export function ProjectDeliveryHistory({
  projectId,
}: {
  projectId: string;
}): JSX.Element {
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
    return <ProjectDeliveryHistoryMessage message="No delivery history for this project yet." />;
  }

  const overview = buildProjectDeliveryOverview(entries);

  return (
    <div className="space-y-4">
      <Card className="border-border/70 bg-card/80 shadow-none">
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">Delivery overview</CardTitle>
          <p className="text-sm leading-6 text-muted">
            Judge active run pressure, gate load, and reported spend before drilling into a specific board run.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {overview.metrics.map((metric) => (
              <div
                key={metric.label}
                className="rounded-xl border border-border/70 bg-background/70 p-3"
              >
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
                  {metric.label}
                </div>
                <div className="mt-1 text-lg font-semibold text-foreground">{metric.value}</div>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm leading-6 text-muted">
            {overview.summary}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {entries.map((entry) => {
          const packet = buildProjectDeliveryPacket(entry);

          return (
            <Card key={entry.workflow_id} className="border-border/70 bg-card/80 shadow-none">
              <CardContent className="grid gap-4 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="grid gap-2">
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
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                      <span title={packet.createdTitle} className="inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Started {packet.createdLabel}
                      </span>
                      {packet.durationLabel ? <span>Duration {packet.durationLabel}</span> : null}
                    </div>
                    <p className="text-sm leading-6 text-muted">{packet.summary}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" className="justify-between">
                      <Link to={packet.workflowHref}>
                        Open board
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button asChild variant="outline" className="justify-between">
                      <Link to={packet.inspectorHref}>
                        Open inspector
                        <Search className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {packet.metrics.map((metric) => (
                    <div
                      key={`${packet.workflowId}:${metric.label}`}
                      className="rounded-xl border border-border/70 bg-background/70 p-3"
                    >
                      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
                        {metric.label}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-foreground">{metric.value}</div>
                    </div>
                  ))}
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

function ProjectDeliveryHistoryMessage({
  message,
}: {
  message: string;
}): JSX.Element {
  return (
    <Card className="border-border/70 bg-card/80 shadow-none">
      <CardContent className="py-8 text-center text-sm text-muted">{message}</CardContent>
    </Card>
  );
}
