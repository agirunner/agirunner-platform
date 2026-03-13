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
        <CardTitle className="text-base">Recent activity packets</CardTitle>
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
            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-1">
                <div className="text-sm font-medium text-foreground">{packet.headline}</div>
                <div className="text-xs text-muted">{packet.createdAtLabel}</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => props.onOpenTrace(packet.id)}>
                Open trace detail
              </Button>
            </div>

            <p className="text-sm leading-6 text-muted">{packet.summary}</p>
            <p className="text-xs leading-5 text-muted">{packet.nextAction}</p>

            {packet.context.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {packet.context.map((item) => (
                  <Badge key={`${packet.id}:${item}`} variant="outline">
                    {item}
                  </Badge>
                ))}
              </div>
            ) : null}

            {packet.signals.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {packet.signals.map((signal) => (
                  <Badge key={`${packet.id}:${signal}`} variant="secondary">
                    {signal}
                  </Badge>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {packet.workflowContextHref ? (
                <Button size="sm" variant="outline" asChild>
                  <Link to={packet.workflowContextHref}>Board context</Link>
                </Button>
              ) : null}
              {packet.taskRecordHref ? (
                <Button size="sm" variant="outline" asChild>
                  <Link to={packet.taskRecordHref}>Step record</Link>
                </Button>
              ) : null}
            </div>
          </article>
        ))}
      </CardContent>
    </Card>
  );
}
