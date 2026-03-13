import { Link } from 'react-router-dom';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import type { RecentLogActivityPacket } from './logs-page-support.js';

export function LogsPageActivityPackets(props: {
  packets: RecentLogActivityPacket[];
  onOpenTrace(logId: number): void;
}): JSX.Element | null {
  if (props.packets.length === 0) {
    return null;
  }

  return (
    <Card className="border-border/70 bg-card/80 shadow-sm">
      <CardHeader className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Recent activity packets</CardTitle>
          <Badge variant="outline">{props.packets.length} packets</Badge>
        </div>
        <p className="text-sm leading-6 text-muted">
          Use these human-readable summaries to decide whether to stay in the raw stream or open a
          focused trace.
        </p>
      </CardHeader>
      <CardContent className="grid gap-3 xl:grid-cols-3">
        {props.packets.map((packet) => (
          <article
            key={packet.id}
            className="grid gap-3 rounded-xl border border-border/70 bg-background/70 p-4"
          >
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{packet.actorLabel}</Badge>
                  <Badge variant={packet.emphasisTone}>{packet.emphasisLabel}</Badge>
                </div>
                <div className="text-sm font-medium text-foreground">
                  {packet.narrativeHeadline}
                </div>
                <time
                  className="text-xs text-muted"
                  dateTime={packet.createdAtIso}
                  title={packet.createdAtDetail}
                >
                  {packet.createdAtLabel}
                </time>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-between lg:w-auto"
                onClick={() => props.onOpenTrace(packet.id)}
              >
                Open trace detail
              </Button>
            </div>

            <p className="text-sm leading-6 text-muted">{packet.summary}</p>
            <div className="rounded-xl border border-border/70 bg-card/70 p-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                Why surfaced
              </div>
              <p className="mt-2 text-sm leading-6 text-foreground">{packet.whyItMatters}</p>
            </div>

            <dl className="grid gap-3 sm:grid-cols-3">
              {packet.facts.map((fact) => (
                <div
                  key={`${packet.id}:${fact.label}`}
                  className="rounded-xl border border-border/70 bg-card/70 p-3"
                >
                  <dt className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                    {fact.label}
                  </dt>
                  <dd className="mt-2 text-sm leading-6 text-foreground">{fact.value}</dd>
                </div>
              ))}
            </dl>

            {packet.supportingContext.length > 0 ? (
              <details className="rounded-xl border border-border/70 bg-card/60 p-3">
                <summary className="cursor-pointer text-sm font-medium text-foreground">
                  Trace context
                </summary>
                <div className="mt-3 grid gap-3">
                  {packet.signals.length > 0 ? (
                    <div className="grid gap-2">
                      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                        Signals
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {packet.signals.map((signal) => (
                          <Badge key={`${packet.id}:${signal}`} variant="outline">
                            {signal}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="grid gap-2">
                    <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                      Scope chips
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {packet.supportingContext.map((item) => (
                        <Badge key={`${packet.id}:${item}`} variant="outline">
                          {item}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </details>
            ) : null}

            {packet.actions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {packet.actions.map((action) => (
                  <Button
                    key={`${packet.id}:${action.label}`}
                    size="sm"
                    variant="outline"
                    className="w-full justify-between sm:w-auto"
                    asChild
                  >
                    <Link to={action.href}>{action.label}</Link>
                  </Button>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </CardContent>
    </Card>
  );
}
