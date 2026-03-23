import type { DashboardEventRecord } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { StructuredRecordView } from '../../components/structured-data.js';
import type { TimelineDescriptor } from './workflow-history-card.narrative.js';
import { describeTimelineEventPacket } from './workflow-history-card.packet.support.js';
import { toStructuredDetailViewData } from './workflow-detail-presentation.js';

export function TimelineEventPacket(props: {
  event: DashboardEventRecord;
  descriptor: TimelineDescriptor;
}): JSX.Element {
  const reviewPacket = describeTimelineEventPacket(props.event, props.descriptor);

  return (
    <div className="grid gap-3 rounded-lg border border-border/70 bg-surface/80 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            Interaction packet
          </div>
          <div className="text-sm font-medium text-foreground">{reviewPacket.summary}</div>
          <p className="text-sm leading-6 text-muted">{reviewPacket.detail}</p>
        </div>
        <Badge variant="outline">{reviewPacket.typeLabel}</Badge>
      </div>
      {reviewPacket.facts.length > 0 ? (
        <dl className="grid gap-2 sm:grid-cols-2">
          {reviewPacket.facts.map((fact) => (
            <div
              key={`${props.event.id}:${fact.label}`}
              className="grid gap-1 rounded-lg border border-border/70 bg-background/90 px-3 py-2"
            >
              <dt className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                {fact.label}
              </dt>
              <dd className="text-sm text-foreground">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {reviewPacket.badges.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {reviewPacket.badges.map((badge) => (
            <Badge key={`${props.event.id}:${badge}`} variant="outline">
              {badge}
            </Badge>
          ))}
        </div>
      ) : null}
      {reviewPacket.hasStructuredDetail ? (
        <details className="rounded-lg border border-border/60 bg-background/90 p-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            {reviewPacket.disclosureLabel}
          </summary>
          <div className="mt-3">
            <StructuredRecordView
              data={toStructuredDetailViewData(props.event.data)}
              emptyMessage="No event payload."
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}
