import { Link } from 'react-router-dom';

import { Badge } from '../../../components/ui/badge.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card.js';
import type { DashboardMissionControlPacket } from '../../../lib/api.js';
import { buildWorkflowDetailPermalink } from '../../workflow-detail/workflow-detail-permalinks.js';
import { formatRelativeTimestamp } from '../../workflow-detail/workflow-detail-presentation.js';
import { workflowHistoryToneClassName } from '../../workflow-detail/workflow-history-card.js';
import { describeMissionControlPacketCategory } from './mission-control-workspace-support.js';

export function MissionControlWorkspaceHistory(props: {
  workflowId: string;
  packets: DashboardMissionControlPacket[];
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>History</CardTitle>
        <CardDescription>Narrative workflow packet history for review and handoff.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {props.packets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No history packets have been published for this workflow yet.</p>
        ) : (
          props.packets.map((packet) => {
            const category = describeMissionControlPacketCategory(packet.category);
            return (
              <article key={packet.id} className={workflowHistoryToneClassName(category.tone)}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={category.badgeVariant}>{category.label}</Badge>
                  {packet.carryover ? <Badge variant="warning">Carryover</Badge> : null}
                </div>
                <strong>{packet.title}</strong>
                <p className="text-sm text-muted-foreground">{packet.summary}</p>
                <p className="text-xs text-muted-foreground">{formatRelativeTimestamp(packet.changedAt)}</p>
                {packet.outputDescriptors.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {packet.outputDescriptors.map((output) => (
                      <Badge key={`${packet.id}:${output.id}`} variant="outline">
                        {output.title}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                <Link
                  className="text-sm font-medium text-accent underline-offset-4 hover:underline"
                  to={buildWorkflowDetailPermalink(props.workflowId, {})}
                >
                  Open workflow context
                </Link>
              </article>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
