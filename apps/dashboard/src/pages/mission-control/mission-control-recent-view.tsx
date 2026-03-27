import { Link } from 'react-router-dom';

import type { DashboardMissionControlRecentResponse } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { buildMissionControlShellHref } from './mission-control-page.support.js';
import { MissionControlTaskLensView } from './mission-control-task-lens-view.js';
import type { TaskListRecord } from '../task-list/task-list-page.support.js';

export function MissionControlRecentView(props: {
  response: DashboardMissionControlRecentResponse | null;
  isLoading: boolean;
  lens: 'workflows' | 'tasks';
  taskLensResponse: TaskListRecord[];
}): JSX.Element {
  if (props.lens === 'tasks') {
    return (
      <MissionControlTaskLensView
        mode="recent"
        tasks={props.taskLensResponse}
        isLoading={props.isLoading}
      />
    );
  }

  if (props.isLoading && !props.response) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Loading recent activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Shift handoff</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Review packets summarize what changed recently and what still carries over into the next operating window.
        </CardContent>
      </Card>

      {(props.response?.packets ?? []).map((packet) => (
        <Card key={packet.id}>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div className="space-y-1">
              <CardTitle className="text-base">{packet.title}</CardTitle>
              <p className="text-sm text-muted-foreground">{packet.summary}</p>
            </div>
            {packet.carryover ? <Badge>Carryover</Badge> : null}
          </CardHeader>
          <CardContent>
            {packet.workflowId ? (
              <Link
                className="text-sm font-medium text-accent hover:underline"
                to={buildMissionControlShellHref({
                  mode: 'recent',
                  rail: 'workflow',
                  workflowId: packet.workflowId,
                })}
              >
                Open workflow
              </Link>
            ) : (
              <span className="text-sm text-muted-foreground">Workflow context unavailable</span>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
