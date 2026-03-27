import { Link } from 'react-router-dom';

import type { DashboardMissionControlHistoryResponse } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { buildMissionControlShellHref } from './mission-control-page.support.js';

export function MissionControlHistoryView(props: {
  response: DashboardMissionControlHistoryResponse | null;
  isLoading: boolean;
}): JSX.Element {
  if (props.isLoading && !props.response) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Loading history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Historical record</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          History keeps the deeper packet trail available without dropping straight into logs or diagnostics.
        </CardContent>
      </Card>

      {(props.response?.packets ?? []).map((packet) => (
        <Card key={packet.id}>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div className="space-y-1">
              <CardTitle className="text-base">{packet.title}</CardTitle>
              <p className="text-sm text-muted-foreground">{packet.summary}</p>
            </div>
            <Badge variant="outline">{describeCategory(packet.category)}</Badge>
          </CardHeader>
          <CardContent>
            <Link
              className="text-sm font-medium text-accent hover:underline"
              to={buildMissionControlShellHref({
                mode: 'history',
                rail: 'workflow',
                workflowId: packet.workflowId,
              })}
            >
              Open workflow
            </Link>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function describeCategory(category: DashboardMissionControlHistoryResponse['packets'][number]['category']): string {
  switch (category) {
    case 'decision':
      return 'Decision';
    case 'intervention':
      return 'Intervention';
    case 'progress':
      return 'Progress';
    case 'output':
      return 'Output';
    default:
      return 'System';
  }
}
