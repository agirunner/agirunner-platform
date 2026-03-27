import { useEffect, useState } from 'react';

import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card.js';
import type {
  DashboardMissionControlOutputDescriptor,
  DashboardMissionControlOutputLocation,
  DashboardMissionControlPacket,
} from '../../../lib/api.js';
import { formatRelativeTimestamp } from '../../workflow-detail/workflow-detail-presentation.js';
import { describeMissionControlPacketCategory } from './mission-control-workspace-support.js';

type OutputDetailMode = 'summary' | 'operational' | 'forensic';

export function MissionControlWorkspaceOutputs(props: {
  deliverables: DashboardMissionControlOutputDescriptor[];
  feed: DashboardMissionControlPacket[];
  initialDetailMode?: OutputDetailMode;
}): JSX.Element {
  const [detailMode, setDetailMode] = useState<OutputDetailMode>(props.initialDetailMode ?? 'summary');

  useEffect(() => {
    setDetailMode(props.initialDetailMode ?? 'summary');
  }, [props.initialDetailMode]);

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Deliverables</CardTitle>
          <CardDescription>Current and final outputs using platform-authored output descriptors only.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setDetailMode('summary')} size="sm" variant={detailMode === 'summary' ? 'default' : 'outline'}>
              Summary
            </Button>
            <Button onClick={() => setDetailMode('operational')} size="sm" variant={detailMode === 'operational' ? 'default' : 'outline'}>
              Operational
            </Button>
            <Button onClick={() => setDetailMode('forensic')} size="sm" variant={detailMode === 'forensic' ? 'default' : 'outline'}>
              Forensic
            </Button>
          </div>
          {props.deliverables.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deliverables are available for this workflow yet.</p>
          ) : (
            props.deliverables.map((deliverable) => (
              <DeliverableCard key={deliverable.id} deliverable={deliverable} detailMode={detailMode} />
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Live output feed</CardTitle>
          <CardDescription>Meaningful output progression and operator-facing packet history for this workflow.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {props.feed.length === 0 ? (
            <p className="text-sm text-muted-foreground">No output feed packets are available for this workflow yet.</p>
          ) : (
            props.feed.map((packet) => (
              <OutputFeedCard key={packet.id} packet={packet} detailMode={detailMode} />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DeliverableCard(props: {
  deliverable: DashboardMissionControlOutputDescriptor;
  detailMode: OutputDetailMode;
}): JSX.Element {
  const primaryLocation = describeOutputLocation(props.deliverable.primaryLocation);

  return (
    <article className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{props.deliverable.title}</strong>
        <Badge variant="outline">{props.deliverable.status.replaceAll('_', ' ')}</Badge>
      </div>
      {props.deliverable.summary ? <p className="text-sm text-muted-foreground">{props.deliverable.summary}</p> : null}
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        {props.deliverable.producedByRole ? <span>Produced by {props.deliverable.producedByRole}</span> : null}
        {props.deliverable.stageName ? <span>{humanizeToken(props.deliverable.stageName)}</span> : null}
      </div>
      <OutputLocationLine label={primaryLocation.label} href={primaryLocation.href} detail={primaryLocation.detail} />
      {props.detailMode !== 'summary' && props.deliverable.secondaryLocations.length > 0 ? (
        <div className="grid gap-2">
          {props.deliverable.secondaryLocations.map((location, index) => {
            const secondary = describeOutputLocation(location);
            return (
              <OutputLocationLine
                key={`${props.deliverable.id}:secondary:${index}`}
                label={secondary.label}
                href={secondary.href}
                detail={secondary.detail}
              />
            );
          })}
        </div>
      ) : null}
    </article>
  );
}

function OutputFeedCard(props: {
  packet: DashboardMissionControlPacket;
  detailMode: OutputDetailMode;
}): JSX.Element {
  const category = describeMissionControlPacketCategory(props.packet.category);

  return (
    <article className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={category.badgeVariant}>{category.label}</Badge>
        <span className="text-xs text-muted-foreground">{formatRelativeTimestamp(props.packet.changedAt)}</span>
      </div>
      <strong>{props.packet.title}</strong>
      <p className="text-sm text-muted-foreground">{props.packet.summary}</p>
      {props.detailMode !== 'summary' ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          {props.packet.outputDescriptors[0]?.producedByRole ? (
            <span>Produced by {props.packet.outputDescriptors[0].producedByRole}</span>
          ) : null}
          {props.packet.outputDescriptors[0]?.stageName ? (
            <span>{humanizeToken(props.packet.outputDescriptors[0].stageName)}</span>
          ) : null}
        </div>
      ) : null}
      {props.packet.outputDescriptors.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {props.packet.outputDescriptors.map((descriptor) => (
            <Badge key={`${props.packet.id}:${descriptor.id}`} variant="outline">
              {descriptor.title}
            </Badge>
          ))}
        </div>
      ) : null}
      {props.detailMode === 'forensic' ? (
        <div className="grid gap-1 text-xs text-muted-foreground">
          <span>Packet id {props.packet.id}</span>
          <span>Output descriptor count {props.packet.outputDescriptors.length}</span>
        </div>
      ) : null}
    </article>
  );
}

function OutputLocationLine(props: {
  label: string;
  href: string | null;
  detail: string | null;
}): JSX.Element {
  return (
    <div className="grid gap-1 text-sm">
      {props.href ? (
        <a className="font-medium text-accent underline-offset-4 hover:underline" href={props.href}>
          {props.label}
        </a>
      ) : (
        <span className="font-medium text-foreground">{props.label}</span>
      )}
      {props.detail ? <span className="text-muted-foreground">{props.detail}</span> : null}
    </div>
  );
}

function describeOutputLocation(
  location: DashboardMissionControlOutputLocation,
): { label: string; href: string | null; detail: string | null } {
  switch (location.kind) {
    case 'artifact':
      return {
        label: location.previewPath ? 'Preview artifact' : 'Download artifact',
        href: location.previewPath ?? location.downloadPath,
        detail: location.logicalPath,
      };
    case 'repository':
      if (location.pullRequestUrl) {
        return { label: 'Pull request', href: location.pullRequestUrl, detail: location.repository };
      }
      if (location.commitUrl && location.commitSha) {
        return { label: `Commit ${location.commitSha}`, href: location.commitUrl, detail: location.repository };
      }
      if (location.branchUrl && location.branch) {
        return { label: `Branch ${location.branch}`, href: location.branchUrl, detail: location.repository };
      }
      return { label: 'Repository output', href: null, detail: location.repository };
    case 'host_directory':
      return { label: 'Host directory', href: null, detail: location.path };
    case 'workflow_document':
      return { label: 'Workflow document', href: location.location, detail: location.logicalName };
    case 'external_url':
      return { label: 'External URL', href: location.url, detail: location.url };
    default:
      return { label: 'Output', href: null, detail: null };
  }
}

function humanizeToken(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
