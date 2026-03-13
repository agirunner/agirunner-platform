import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import {
  BOARD_COLUMNS,
  describeGateSummary,
  describeOperatorSignal,
  describeWorkflowCost,
  describeWorkflowProgress,
  describeWorkflowStage,
  describeWorkflowType,
  formatRelativeRunAge,
  resolveStatus,
  statusBadgeVariant,
  type BoardColumn,
  type WorkflowListRecord,
} from './workflow-list-support.js';
import {
  describeWorkflowStageFootnote,
  describeWorkflowStageLabel,
} from './workflow-list-stage-presentation.js';
import { EmptyWorkflowState, WorkflowInfo } from './workflow-list-layouts.js';

type BoardSection = {
  column: BoardColumn;
  workflows: WorkflowListRecord[];
};

export function WorkflowBoard(props: { workflows: WorkflowListRecord[] }): JSX.Element {
  const sections = useMemo(() => groupBoardSections(props.workflows), [props.workflows]);

  if (props.workflows.length === 0) {
    return <EmptyWorkflowState />;
  }

  return (
    <div className="space-y-4">
      <Card className="border-border/70 shadow-sm xl:hidden">
        <CardContent className="grid gap-3 p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Jump to posture</p>
            <p className="text-xs text-muted">
              Review the board sections in posture order without horizontal scrolling.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {sections.map((section) => (
              <Button key={section.column} variant="outline" size="sm" asChild>
                <a href={`#workflow-posture-${section.column}`}>
                  {section.column}
                  <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {section.workflows.length}
                  </span>
                </a>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:hidden">
        {sections.map((section) => (
          <BoardColumnView key={section.column} column={section.column} workflows={section.workflows} />
        ))}
      </div>

      <div className="hidden gap-4 xl:grid xl:grid-cols-2 2xl:grid-cols-5">
        {sections.map((section) => (
          <BoardColumnView key={section.column} column={section.column} workflows={section.workflows} />
        ))}
      </div>
    </div>
  );
}

function BoardColumnView(props: BoardSection): JSX.Element {
  return (
    <section
      id={`workflow-posture-${props.column}`}
      className="rounded-2xl border border-border/70 bg-card/70 p-3 shadow-sm"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="space-y-1">
          <Badge variant={statusBadgeVariant(props.column)} className="capitalize">
            {props.column}
          </Badge>
          <p className="text-xs text-muted">
            {describeColumnSummary(props.column, props.workflows.length)}
          </p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {props.workflows.length}
        </span>
      </div>
      <div className="space-y-3">
        {props.workflows.map((workflow) => (
          <Link key={workflow.id} to={`/work/boards/${workflow.id}`} className="block">
            <Card className="border-border/70 transition-shadow hover:shadow-md">
              <CardContent className="grid gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm font-semibold">{workflow.name}</p>
                    <p className="truncate text-xs text-muted">
                      {workflow.project_name ?? 'No project'}
                    </p>
                  </div>
                  <Badge variant="outline">{describeWorkflowType(workflow)}</Badge>
                </div>
                <p className="text-xs text-foreground">{describeOperatorSignal(workflow)}</p>
                <div className="grid gap-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs sm:grid-cols-2">
                  <WorkflowInfo
                    label={describeWorkflowStageLabel(workflow)}
                    value={describeWorkflowStage(workflow)}
                  />
                  <WorkflowInfo label="Progress" value={describeWorkflowProgress(workflow)} />
                  <WorkflowInfo label="Gates" value={describeGateSummary(workflow)} />
                  <WorkflowInfo label="Spend" value={describeWorkflowCost(workflow)} />
                </div>
                <div className="flex items-center justify-between gap-3 text-xs text-muted">
                  <span>{formatRelativeRunAge(workflow.created_at)}</span>
                  <span>{describeWorkflowStageFootnote(workflow)}</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {props.workflows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/10 px-4 py-6 text-center text-xs text-muted">
            No boards in this posture.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function groupBoardSections(workflows: WorkflowListRecord[]): BoardSection[] {
  const grouped = new Map<BoardColumn, WorkflowListRecord[]>();
  for (const column of BOARD_COLUMNS) {
    grouped.set(column, []);
  }
  for (const workflow of workflows) {
    const status = resolveStatus(workflow) as BoardColumn;
    const bucket = BOARD_COLUMNS.includes(status) ? status : 'planned';
    grouped.get(bucket)?.push(workflow);
  }
  return BOARD_COLUMNS.map((column) => ({
    column,
    workflows: grouped.get(column) ?? [],
  }));
}

function describeColumnSummary(column: BoardColumn, count: number): string {
  if (count === 0) {
    return 'Nothing queued right now';
  }
  switch (column) {
    case 'active':
      return `${count} board run${count === 1 ? '' : 's'} currently moving work`;
    case 'gated':
      return `${count} board run${count === 1 ? '' : 's'} waiting on human review`;
    case 'blocked':
      return `${count} board run${count === 1 ? '' : 's'} need intervention`;
    case 'done':
      return `${count} board run${count === 1 ? '' : 's'} are fully delivered`;
    default:
      return `${count} board run${count === 1 ? '' : 's'} planned but not moving yet`;
  }
}
