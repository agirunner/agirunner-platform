import type { DashboardMissionControlLiveResponse } from '../../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { MissionControlCanvas } from './mission-control-canvas.js';

export function MissionControlLiveView(props: {
  response: DashboardMissionControlLiveResponse | null;
  isLoading: boolean;
  selectedWorkflowId: string | null;
  lens: 'workflows' | 'tasks';
  onSelectWorkflow: (workflowId: string) => void;
}): JSX.Element {
  if (props.isLoading && !props.response) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Loading live operations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Workflow-first live operations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Live mode keeps workflows as the primary operational object while the right rail stays
            interrupt-first.
          </p>
          {props.lens === 'tasks' ? (
            <p>Task lens is active. Mission Control is still workflow-first, but task-heavy signals stay emphasized.</p>
          ) : null}
        </CardContent>
      </Card>

      <MissionControlCanvas
        sections={props.response?.sections ?? []}
        selectedWorkflowId={props.selectedWorkflowId}
        onSelectWorkflow={props.onSelectWorkflow}
      />
    </div>
  );
}
