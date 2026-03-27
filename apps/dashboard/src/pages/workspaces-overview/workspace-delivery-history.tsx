import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { dashboardApi } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  buildWorkspaceDeliveryAttentionOverview,
  buildWorkspaceDeliveryAttentionState,
  buildWorkspaceDeliveryPacket,
} from './workspace-delivery-history-support.js';

const deliveryTimelineQueryKey = ['workspace-timeline'];

export function WorkspaceDeliveryHistory({ workspaceId }: { workspaceId: string }): JSX.Element {
  const timelineQuery = useQuery({
    queryKey: [...deliveryTimelineQueryKey, workspaceId],
    queryFn: () => dashboardApi.getWorkspaceTimeline(workspaceId),
    enabled: workspaceId.length > 0,
  });

  const timeline = timelineQuery.data ?? [];
  const overview = useMemo(() => buildWorkspaceDeliveryAttentionOverview(timeline), [timeline]);
  const packets = useMemo(() => timeline.map(buildWorkspaceDeliveryPacket), [timeline]);
  const attentionStates = useMemo(
    () => timeline.map(buildWorkspaceDeliveryAttentionState),
    [timeline],
  );

  if (timelineQuery.isLoading) {
    return <DeliveryLoadingCard />;
  }

  if (timelineQuery.isError) {
    return (
      <DeliveryEmptyCard
        title="Workspace delivery is unavailable"
        message="The delivery timeline could not be loaded right now. Please try again."
      />
    );
  }

  if (timeline.length === 0) {
    return (
      <DeliveryEmptyCard
        title="No delivery history yet"
        message="This workspace has not produced any workflow runs yet."
      />
    );
  }

  return (
    <Card className="border-border/70 bg-card/80 shadow-none">
      <CardHeader className="space-y-3">
        <Badge variant="warning" className="w-fit">
          Delivery Overview
        </Badge>
        <div className="space-y-2">
          <CardTitle className="text-xl tracking-tight">Workspace delivery timeline</CardTitle>
          <CardDescription className="max-w-3xl leading-7 text-muted">
            {overview.summary}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 p-6 pt-0 sm:p-8 sm:pt-0">
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="space-y-4 rounded-xl border border-border/70 bg-border/10 p-4">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">Next Move</p>
              <p className="text-sm leading-6 text-muted">{overview.packets[3]?.detail}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to={overview.nextActionHref}>
                  {isDiagnosticsHref(overview.nextActionHref) ? 'Open inspector' : 'Open board'}
                </Link>
              </Button>
            </div>
          </div>
          <div className="space-y-3 rounded-xl border border-border/70 bg-border/10 p-4">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">
              Recent Signals
            </p>
            <div className="grid gap-3">
              {overview.packets.map((packet) => (
                <div key={packet.label} className="rounded-lg border border-border/60 bg-background/80 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">{packet.label}</p>
                  <p className="mt-1 text-sm font-medium text-foreground">{packet.value}</p>
                  <p className="mt-1 text-xs leading-5 text-muted">{packet.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">Run Cards</p>
          <div className="grid gap-4 lg:grid-cols-2">
            {packets.map((packet, index) => (
              <DeliveryRunCard
                key={packet.workflowId}
                packet={packet}
                attentionState={attentionStates[index]}
              />
            ))}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

function DeliveryRunCard({
  packet,
  attentionState,
}: {
  packet: ReturnType<typeof buildWorkspaceDeliveryPacket>;
  attentionState: ReturnType<typeof buildWorkspaceDeliveryAttentionState>;
}): JSX.Element {
  const actionLabel = isDiagnosticsHref(attentionState.primaryActionHref)
    ? 'Open inspector'
    : 'Open board';

  return (
    <Card className="border-border/70 bg-background/80 shadow-none">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={packet.stateVariant}>{packet.stateLabel}</Badge>
          <Badge variant="outline">{attentionState.attentionLabel}</Badge>
          {packet.durationLabel ? <Badge variant="secondary">{packet.durationLabel}</Badge> : null}
        </div>
        <div className="space-y-1">
          <CardTitle className="text-base tracking-tight">{packet.workflowName}</CardTitle>
          <CardDescription>{attentionState.nextAction}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={packet.workflowHref}>Open board</Link>
          </Button>
          <Button asChild size="sm">
            <Link to={attentionState.primaryActionHref}>{actionLabel}</Link>
          </Button>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Recent Signals</p>
          {packet.signals.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {packet.signals.map((signal) => (
                <Badge key={`${packet.workflowId}:${signal}`} variant="outline">
                  {signal}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No recent signals yet.</p>
          )}
        </div>
        <p className="text-xs text-muted">
          Started {packet.createdLabel} on {packet.createdTitle}.
        </p>
      </CardContent>
    </Card>
  );
}

function isDiagnosticsHref(value: string): boolean {
  return value.includes('/diagnostics/live-logs');
}

function DeliveryEmptyCard({
  title,
  message,
}: {
  title: string;
  message: string;
}): JSX.Element {
  return (
    <Card className="border-border/70 bg-card/80 shadow-none">
      <CardContent className="grid gap-3 p-6 sm:p-8">
        <Badge variant="warning" className="w-fit">
          Delivery Overview
        </Badge>
        <div className="space-y-2">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
          <p className="max-w-3xl text-sm leading-7 text-muted">{message}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function DeliveryLoadingCard(): JSX.Element {
  return <DeliveryEmptyCard title="Loading delivery history" message="Fetching workspace runs..." />;
}
