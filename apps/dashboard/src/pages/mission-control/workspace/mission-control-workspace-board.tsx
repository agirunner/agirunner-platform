import { Link } from 'react-router-dom';

import { Badge } from '../../../components/ui/badge.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card.js';
import type { DashboardWorkflowBoardResponse, DashboardWorkflowWorkItemRecord } from '../../../lib/api.js';
import { buildWorkflowDetailPermalink } from '../../workflow-detail/workflow-detail-permalinks.js';
import { groupWorkflowWorkItems } from '../../workflow-detail/workflow-work-item-detail-support.js';
import { formatCountLabel } from '../../workflow-detail/workflow-ux-formatting.js';

export function MissionControlWorkspaceBoard(props: {
  workflowId: string;
  board: DashboardWorkflowBoardResponse | null;
}): JSX.Element {
  if (!props.board) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Board</CardTitle>
          <CardDescription>Work-item-first stage view for the selected workflow.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No board state is available for this workflow yet.</p>
        </CardContent>
      </Card>
    );
  }

  const columnLabels = new Map(props.board.columns.map((column) => [column.id, column.label]));
  const groupedWorkItems = groupWorkflowWorkItems(props.board.work_items);
  const groupedStages = groupStages(props.board, groupedWorkItems);

  return (
    <div className="grid gap-4">
      {groupedStages.map((stage) => (
        <Card key={stage.name}>
          <CardHeader>
            <CardTitle>{humanizeToken(stage.name)}</CardTitle>
            <CardDescription>{stage.goal || 'No stage goal published for this workflow stage.'}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {stage.workItems.map((workItem) => (
              <article key={workItem.id} className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{workItem.title}</strong>
                  <Badge variant="outline">{columnLabels.get(workItem.column_id) ?? workItem.column_id}</Badge>
                  <Badge variant="outline">{workItem.priority}</Badge>
                  {workItem.escalation_status === 'open' ? <Badge variant="warning">Open escalation</Badge> : null}
                  {workItem.blocked_state === 'blocked' ? <Badge variant="destructive">Blocked</Badge> : null}
                </div>
                {workItem.owner_role ? <p className="text-sm text-foreground">Owner {workItem.owner_role}</p> : null}
                {workItem.next_expected_actor || workItem.next_expected_action ? (
                  <p className="text-sm text-muted-foreground">
                    {describeExpectedAction(workItem.next_expected_actor, workItem.next_expected_action)}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <span>{formatCountLabel(workItem.task_count ?? 0, 'tracked step', 'No tracked steps')}</span>
                  {workItem.children_count ? <span>{formatCountLabel(workItem.children_count, 'child work item', 'No child work items')}</span> : null}
                  {workItem.gate_status ? <span>Gate {workItem.gate_status.replaceAll('_', ' ')}</span> : null}
                  {workItem.rework_count ? <span>{formatCountLabel(workItem.rework_count, 'rework cycle', 'No rework')}</span> : null}
                </div>
                {workItem.blocked_reason ? (
                  <p className="text-sm text-foreground">{workItem.blocked_reason}</p>
                ) : null}
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <Link
                    className="font-medium text-accent underline-offset-4 hover:underline"
                    to={buildWorkflowDetailPermalink(props.workflowId, { workItemId: workItem.id })}
                  >
                    Open workflow context
                  </Link>
                </div>
              </article>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function groupStages(
  board: DashboardWorkflowBoardResponse,
  groupedWorkItems: DashboardWorkflowWorkItemRecord[],
): Array<{ name: string; goal: string; workItems: DashboardWorkflowWorkItemRecord[] }> {
  const stageOrder = board.stage_summary.map((stage) => stage.name);
  const stageMap = new Map(
    board.stage_summary.map((stage) => [
      stage.name,
      {
        name: stage.name,
        goal: stage.goal,
        workItems: [] as DashboardWorkflowWorkItemRecord[],
      },
    ]),
  );

  for (const workItem of groupedWorkItems) {
    const existingStage = stageMap.get(workItem.stage_name);
    if (existingStage) {
      existingStage.workItems.push(workItem);
      continue;
    }
    stageMap.set(workItem.stage_name, {
      name: workItem.stage_name,
      goal: workItem.goal ?? '',
      workItems: [workItem],
    });
    stageOrder.push(workItem.stage_name);
  }

  return stageOrder
    .map((stageName) => stageMap.get(stageName))
    .filter((stage): stage is { name: string; goal: string; workItems: DashboardWorkflowWorkItemRecord[] } => Boolean(stage))
    .filter((stage) => stage.workItems.length > 0);
}

function describeExpectedAction(actor: string | null | undefined, action: string | null | undefined): string {
  if (actor && action) {
    return `${actor} should ${action.charAt(0).toLowerCase()}${action.slice(1)}`;
  }
  return actor ?? action ?? 'No next expected action published.';
}

function humanizeToken(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
