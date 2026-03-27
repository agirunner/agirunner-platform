import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import type { DashboardMissionControlWorkspaceResponse } from '../../lib/api.js';
import { buildWorkflowDetailPermalink } from '../workflow-detail/workflow-detail-permalinks.js';
import { WorkflowControlActions } from '../workflow-detail/workflow-control-actions.js';
import { formatRelativeTimestamp } from '../workflow-detail/workflow-detail-presentation.js';
import { coerceMissionControlBoard, describeMissionControlPosture } from './workspace/mission-control-workspace-support.js';
import { MissionControlWorkspaceBoard } from './workspace/mission-control-workspace-board.js';
import { MissionControlWorkspaceHistory } from './workspace/mission-control-workspace-history.js';
import { MissionControlWorkspaceOverview } from './workspace/mission-control-workspace-overview.js';

type MissionControlWorkspaceTab = 'overview' | 'board' | 'history';

export function MissionControlWorkspacePane(props: {
  workflowId: string | null;
  response: DashboardMissionControlWorkspaceResponse | null;
  isLoading: boolean;
  initialTab?: MissionControlWorkspaceTab;
  isMobileTakeover?: boolean;
}): JSX.Element {
  const [tab, setTab] = useState<MissionControlWorkspaceTab>(props.initialTab ?? 'overview');

  useEffect(() => {
    setTab(props.initialTab ?? 'overview');
  }, [props.initialTab, props.workflowId]);

  if (!props.workflowId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Selected workflow</CardTitle>
          <CardDescription>Choose a workflow from the live, recent, or history surfaces to open its workspace here.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (props.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Loading workflow workspace</CardTitle>
          <CardDescription>Fetching overview, board, outputs, steering, and history packets for the selected workflow.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!props.response?.workflow || !props.response.overview) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Workflow workspace unavailable</CardTitle>
          <CardDescription>The selected workflow could not be loaded into the Mission Control workspace.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const workflow = props.response.workflow;
  const board = coerceMissionControlBoard(props.response.board);
  const posture = describeMissionControlPosture(workflow.posture);
  const inspectorHref = `/mission-control/workflows/${workflow.id}/inspector`;

  return (
    <Card className="h-full">
      <CardHeader>
        {props.isMobileTakeover ? (
          <Link className="text-sm font-medium text-accent underline-offset-4 hover:underline xl:hidden" to="/mission-control">
            Return to live shell
          </Link>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{workflow.name}</CardTitle>
          <Badge variant={posture.variant}>{posture.label}</Badge>
          {workflow.currentStage ? <Badge variant="outline">{workflow.currentStage}</Badge> : null}
        </div>
        <CardDescription>
          {workflow.playbookName ?? 'Unknown playbook'}
          {workflow.workspaceName ? ` • ${workflow.workspaceName}` : ''}
        </CardDescription>
        <div className="grid gap-2">
          <p className="text-sm text-foreground">{workflow.pulse.summary}</p>
          <p className="text-xs text-muted-foreground">
            Last changed {formatRelativeTimestamp(workflow.metrics.lastChangedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WorkflowControlActions
            workflowId={workflow.id}
            workflowState={workflow.state}
            workspaceId={workflow.workspaceId}
            additionalQueryKeys={[['mission-control']]}
          />
          <Link
            className="text-sm font-medium text-accent underline-offset-4 hover:underline"
            to={buildWorkflowDetailPermalink(workflow.id, {})}
          >
            Open full workflow
          </Link>
          <Link
            className="text-sm font-medium text-accent underline-offset-4 hover:underline"
            to={inspectorHref}
          >
            Open inspector
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(value) => setTab(value as MissionControlWorkspaceTab)}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="board">Board</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <MissionControlWorkspaceOverview workflow={workflow} overview={props.response.overview} />
          </TabsContent>
          <TabsContent value="board">
            <MissionControlWorkspaceBoard workflowId={workflow.id} board={board} />
          </TabsContent>
          <TabsContent value="history">
            <MissionControlWorkspaceHistory workflowId={workflow.id} packets={props.response.history.packets} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
