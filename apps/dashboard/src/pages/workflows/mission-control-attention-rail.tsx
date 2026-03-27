import { Link } from 'react-router-dom';

import type { DashboardMissionControlAttentionItem } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { buildMissionControlShellHref } from './mission-control-page.support.js';

const ATTENTION_LANES: Array<{
  id: DashboardMissionControlAttentionItem['lane'];
  title: string;
}> = [
  { id: 'needs_decision', title: 'Needs Decision' },
  { id: 'needs_intervention', title: 'Needs Intervention' },
  { id: 'watchlist', title: 'Watchlist / FYI' },
];

export function MissionControlAttentionRail(props: {
  items: DashboardMissionControlAttentionItem[];
}): JSX.Element {
  return (
    <div className="space-y-4">
      {ATTENTION_LANES.map((lane) => {
        const items = props.items.filter((item) => item.lane === lane.id);
        return (
          <Card key={lane.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm">{lane.title}</CardTitle>
              <Badge variant="outline">{items.length}</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing waiting here right now.</p>
              ) : (
                items.map((item) => (
                  <div key={item.id} className="rounded-lg border border-border/60 bg-muted/10 p-3">
                    <p className="text-sm font-medium text-foreground">{item.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{item.summary}</p>
                    <Link
                      className="mt-3 inline-flex text-sm font-medium text-accent hover:underline"
                      to={buildMissionControlShellHref({
                        rail: 'workflow',
                        workflowId: item.workflowId,
                      })}
                    >
                      Open workflow
                    </Link>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
